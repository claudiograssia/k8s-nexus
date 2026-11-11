//! High-performance log aggregation engine.
//!
//! Resolves a set of pods (explicit list, label selector, or the pods behind a
//! workload) and multiplexes their log streams into per-line Tauri events. The
//! search/filter (regex, case-sensitivity, whole-word) runs here in Rust so the
//! UI only ever receives lines that already matched.

use crate::error::{AppError, AppResult};
use crate::kube::client::ClientPool;
use futures::{AsyncBufReadExt, TryStreamExt};
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, ListParams, LogParams};
use parking_lot::Mutex;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

/// Client-supplied filter toggles (mirrors the log toolbar in the UI).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSpec {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
}

impl FilterSpec {
    /// Compile the toggles into a single matcher, validating user regex up front.
    fn compile(&self) -> AppResult<Option<Regex>> {
        if self.query.trim().is_empty() {
            return Ok(None);
        }
        let mut pattern = if self.regex {
            self.query.clone()
        } else {
            regex::escape(&self.query)
        };
        if self.whole_word {
            pattern = format!(r"\b(?:{pattern})\b");
        }
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!self.case_sensitive)
            .build()
            .map_err(|e| AppError::internal(format!("Invalid regex: {e}")))?;
        Ok(Some(re))
    }
}

/// How to pick the pods whose logs get aggregated.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRequest {
    pub context: String,
    pub namespace: String,
    /// Explicit pod names (single pod, or the replicas of a workload the UI resolved).
    #[serde(default)]
    pub pods: Vec<String>,
    /// Aggregate every pod matching this label selector (e.g. `app=my-service`).
    #[serde(default)]
    pub label_selector: Option<String>,
    /// Restrict to a container; when absent, kube streams the default container.
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default = "default_true")]
    pub follow: bool,
    #[serde(default)]
    pub tail_lines: Option<i64>,
    /// Show logs from the previous (terminated/crashed) container instance.
    #[serde(default)]
    pub previous: bool,
    #[serde(default)]
    pub filter: FilterSpec,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub session_id: String,
    pub pod: String,
    pub seq: u64,
    pub message: String,
}

/// Tracks the background stream tasks for every active log session so they can
/// be aborted when the user closes a log view.
#[derive(Clone, Default)]
pub struct LogSessions {
    inner: Arc<Mutex<HashMap<String, Vec<JoinHandle<()>>>>>,
}

impl LogSessions {
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, session_id: &str, handles: Vec<JoinHandle<()>>) {
        self.inner
            .lock()
            .entry(session_id.to_string())
            .or_default()
            .extend(handles);
    }

    pub fn stop(&self, session_id: &str) {
        if let Some(handles) = self.inner.lock().remove(session_id) {
            for h in handles {
                h.abort();
            }
        }
    }

    #[allow(dead_code)]
    pub fn stop_all(&self) {
        let mut guard = self.inner.lock();
        for (_, handles) in guard.drain() {
            for h in handles {
                h.abort();
            }
        }
    }
}

/// Start streaming. Returns the resolved pod list; lines are delivered
/// asynchronously via `log://line` events tagged with `session_id`.
pub async fn start_stream(
    app: AppHandle,
    pool: &ClientPool,
    sessions: &LogSessions,
    session_id: String,
    req: LogRequest,
) -> AppResult<Vec<String>> {
    let matcher = Arc::new(req.filter.compile()?);
    let client = pool.get(&req.context).await?;
    let api: Api<Pod> = Api::namespaced(client, &req.namespace);

    // Resolve the pod set.
    let pods: Vec<String> = if let Some(sel) = req
        .label_selector
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        let lp = ListParams::default().labels(sel);
        api.list(&lp)
            .await?
            .items
            .into_iter()
            .filter_map(|p| p.metadata.name)
            .collect()
    } else {
        req.pods.clone()
    };

    if pods.is_empty() {
        return Err(AppError::internal(
            "No pods matched the log request (empty pod list / selector).",
        ));
    }

    let seq = Arc::new(AtomicU64::new(0));

    // Resolve the concrete (pod, container, label) streams to open.
    // - A specific container requested → stream just that one per pod (label = pod).
    // - Otherwise enumerate the pod's containers: single → that one (label = pod);
    //   multiple → one stream per container (label = "pod:container").
    // This avoids the "a container name must be specified" 400 on multi-container pods.
    let requested = req.container.clone().filter(|s| !s.trim().is_empty());
    let mut sources: Vec<(String, Option<String>, String)> = Vec::new();
    for pod in &pods {
        if let Some(c) = requested.clone() {
            sources.push((pod.clone(), Some(c), pod.clone()));
            continue;
        }
        match api.get(pod).await {
            Ok(p) => {
                let names: Vec<String> = p
                    .spec
                    .map(|s| s.containers.into_iter().map(|c| c.name).collect())
                    .unwrap_or_default();
                match names.len() {
                    0 => sources.push((pod.clone(), None, pod.clone())),
                    1 => sources.push((pod.clone(), names.into_iter().next(), pod.clone())),
                    _ => {
                        for c in names {
                            let label = format!("{pod}:{c}");
                            sources.push((pod.clone(), Some(c), label));
                        }
                    }
                }
            }
            // Best effort if we cannot read the pod spec.
            Err(_) => sources.push((pod.clone(), None, pod.clone())),
        }
    }

    let mut handles = Vec::with_capacity(sources.len());
    for (pod_name, container, label) in &sources {
        let api = api.clone();
        let app = app.clone();
        let matcher = matcher.clone();
        let seq = seq.clone();
        let session_id = session_id.clone();
        let pod_name = pod_name.clone();
        let label = label.clone();
        let lp = LogParams {
            // Cannot follow a terminated instance, so `previous` forces follow off.
            follow: req.follow && !req.previous,
            previous: req.previous,
            container: container.clone(),
            tail_lines: req.tail_lines.or(Some(500)),
            timestamps: false,
            ..LogParams::default()
        };

        let handle = tokio::spawn(async move {
            let stream = match api.log_stream(&pod_name, &lp).await {
                Ok(s) => s,
                Err(e) => {
                    let _ = app.emit(
                        "log://error",
                        LogLine {
                            session_id: session_id.clone(),
                            pod: label.clone(),
                            seq: 0,
                            message: format!("[stream error] {e}"),
                        },
                    );
                    return;
                }
            };

            let mut lines = stream.lines();
            loop {
                match lines.try_next().await {
                    Ok(Some(line)) => {
                        let keep = match matcher.as_ref() {
                            Some(re) => re.is_match(&line),
                            None => true,
                        };
                        if keep {
                            let n = seq.fetch_add(1, Ordering::Relaxed);
                            let _ = app.emit(
                                "log://line",
                                LogLine {
                                    session_id: session_id.clone(),
                                    pod: label.clone(),
                                    seq: n,
                                    message: line,
                                },
                            );
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        });

        handles.push(handle);
    }

    sessions.register(&session_id, handles);
    let labels: Vec<String> = sources.into_iter().map(|(_, _, label)| label).collect();
    Ok(labels)
}

#[cfg(test)]
mod tests {
    use super::FilterSpec;

    fn spec(query: &str, regex: bool, case_sensitive: bool, whole_word: bool) -> FilterSpec {
        FilterSpec {
            query: query.into(),
            regex,
            case_sensitive,
            whole_word,
        }
    }

    #[test]
    fn empty_query_matches_everything() {
        assert!(spec("  ", false, false, false).compile().unwrap().is_none());
    }

    #[test]
    fn plain_text_is_escaped_and_case_insensitive_by_default() {
        let re = spec("GET /api(v1)", false, false, false)
            .compile()
            .unwrap()
            .unwrap();
        assert!(re.is_match("get /API(v1) 200"));
        assert!(!re.is_match("GET /apiv1"));
    }

    #[test]
    fn case_sensitive_and_whole_word() {
        let re = spec("Error", false, true, true).compile().unwrap().unwrap();
        assert!(re.is_match("an Error occurred"));
        assert!(!re.is_match("an error occurred"));
        assert!(!re.is_match("ErrorHandler started"));
    }

    #[test]
    fn regex_mode_and_invalid_regex() {
        let re = spec(r"\b5\d\d\b", true, false, false)
            .compile()
            .unwrap()
            .unwrap();
        assert!(re.is_match("status=503"));
        assert!(!re.is_match("status=200"));
        let err = spec("(unclosed", true, false, false).compile().unwrap_err();
        assert!(err.message.starts_with("Invalid regex"), "{}", err.message);
    }
}
