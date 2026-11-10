//! Live resource lists: LIST once, then WATCH for changes.
//!
//! One `kube::runtime::watcher` per scope (cluster-wide, or one per namespace
//! when the user can only read some namespaces). The watcher relists by itself
//! when the watch expires (410 Gone) and backs off on transient failures.
//! Changes are coalesced and delivered to the UI as `watch://batch` events.
//!
//! A 403 ends that scope's watcher and is reported with its phase, so the UI
//! can react: `list` denied → try per-namespace scopes; `watch` denied (but
//! list allowed) → fall back to polling.

use crate::error::{AppError, AppResult, ErrorKind};
use crate::kube::client::ClientPool;
use crate::kube::resources::{api_for, GvkSpec};
use futures::StreamExt;
use kube::api::DynamicObject;
use kube::runtime::{watcher, WatchStreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// How long changes are buffered before being emitted as one batch.
const BATCH_WINDOW: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRequest {
    pub context: String,
    pub spec: GvkSpec,
    /// Namespaces to watch, each with its own watcher. Empty = cluster-wide.
    #[serde(default)]
    pub namespaces: Vec<String>,
    #[serde(default)]
    pub label_selector: Option<String>,
}

/// One change for the UI. `scope` is the namespace the watcher covers
/// (empty string for cluster-wide).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Delta {
    /// Full current list of the scope (initial list, and every relist).
    Reset { scope: String, items: Vec<Value> },
    Apply { scope: String, object: Value },
    Delete { scope: String, object: Value },
    Error {
        scope: String,
        kind: ErrorKind,
        message: String,
        /// `list` or `watch`: which call failed.
        phase: &'static str,
        /// The watcher for this scope stopped and will not retry.
        fatal: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Batch {
    watch_id: String,
    deltas: Vec<Delta>,
}

#[derive(Clone, Default)]
pub struct WatchSessions {
    inner: Arc<Mutex<HashMap<String, Vec<JoinHandle<()>>>>>,
}

impl WatchSessions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stop(&self, watch_id: &str) {
        if let Some(handles) = self.inner.lock().remove(watch_id) {
            for h in handles {
                h.abort();
            }
        }
    }
}

pub async fn start(
    app: AppHandle,
    pool: &ClientPool,
    sessions: &WatchSessions,
    watch_id: String,
    request: WatchRequest,
) -> AppResult<()> {
    sessions.stop(&watch_id);
    let client = pool.get(&request.context).await?;

    let scopes: Vec<String> = if request.spec.namespaced && !request.namespaces.is_empty() {
        request.namespaces.clone()
    } else {
        vec![String::new()]
    };

    let mut config = watcher::Config::default();
    if let Some(sel) = request.label_selector.as_deref().filter(|s| !s.is_empty()) {
        config = config.labels(sel);
    }

    let (tx, rx) = mpsc::unbounded_channel::<Delta>();
    let mut handles = Vec::with_capacity(scopes.len() + 1);
    for scope in scopes {
        let ns = (!scope.is_empty()).then_some(scope.as_str());
        let api = api_for(client.clone(), &request.spec, ns);
        handles.push(tokio::spawn(run_scope(api, config.clone(), scope, tx.clone())));
    }
    drop(tx);
    handles.push(tokio::spawn(emit_batches(app, watch_id.clone(), rx)));

    sessions.inner.lock().insert(watch_id, handles);
    Ok(())
}

async fn run_scope(
    api: kube::Api<DynamicObject>,
    config: watcher::Config,
    scope: String,
    tx: mpsc::UnboundedSender<Delta>,
) {
    let mut stream = watcher(api, config).default_backoff().boxed();
    let mut initial: Vec<Value> = Vec::new();
    let mut last_error: Option<String> = None;

    while let Some(event) = stream.next().await {
        let delta = match event {
            Ok(watcher::Event::Init) => {
                initial.clear();
                continue;
            }
            Ok(watcher::Event::InitApply(obj)) => {
                initial.push(to_value(obj));
                continue;
            }
            Ok(watcher::Event::InitDone) => Delta::Reset {
                scope: scope.clone(),
                items: std::mem::take(&mut initial),
            },
            Ok(watcher::Event::Apply(obj)) => Delta::Apply {
                scope: scope.clone(),
                object: to_value(obj),
            },
            Ok(watcher::Event::Delete(obj)) => Delta::Delete {
                scope: scope.clone(),
                object: to_value(obj),
            },
            Err(e) => {
                let (phase, err) = describe(e);
                // 403: no permission. 404: the kind is not served (CRD missing).
                let fatal = matches!(err.kind, ErrorKind::Forbidden | ErrorKind::NotFound)
                    || phase == "watch" && err.message.contains("resourceVersion");
                // The backoff retries transient failures; report each distinct one once.
                if !fatal && last_error.as_deref() == Some(err.message.as_str()) {
                    continue;
                }
                last_error = Some(err.message.clone());
                let delta = Delta::Error {
                    scope: scope.clone(),
                    kind: err.kind,
                    message: err.message,
                    phase,
                    fatal,
                };
                if tx.send(delta).is_err() || fatal {
                    return;
                }
                continue;
            }
        };
        last_error = None;
        if tx.send(delta).is_err() {
            return;
        }
    }
}

fn describe(e: watcher::Error) -> (&'static str, AppError) {
    match e {
        watcher::Error::InitialListFailed(e) => ("list", AppError::from(e)),
        watcher::Error::WatchStartFailed(e) | watcher::Error::WatchFailed(e) => {
            ("watch", AppError::from(e))
        }
        watcher::Error::WatchError(status) => ("watch", AppError::from(kube::Error::Api(status))),
        other => ("watch", AppError::internal(other.to_string())),
    }
}

/// Coalesce deltas into batches so a burst of changes is one UI update.
async fn emit_batches(app: AppHandle, watch_id: String, mut rx: mpsc::UnboundedReceiver<Delta>) {
    while let Some(first) = rx.recv().await {
        tokio::time::sleep(BATCH_WINDOW).await;
        let mut deltas = vec![first];
        while let Ok(d) = rx.try_recv() {
            deltas.push(d);
        }
        let _ = app.emit(
            "watch://batch",
            Batch {
                watch_id: watch_id.clone(),
                deltas,
            },
        );
    }
}

/// Serialize an object without `managedFields`, which the UI never shows and
/// which often makes up half of the payload.
fn to_value(obj: DynamicObject) -> Value {
    let mut value = serde_json::to_value(obj).unwrap_or(Value::Null);
    if let Some(meta) = value.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        meta.remove("managedFields");
    }
    value
}
