//! Native parsing of `~/.kube/config` and the `KUBECONFIG` environment
//! variable, including detection of GKE contexts and their GCP coordinates.

use crate::error::{AppError, AppResult};
use kube::config::Kubeconfig;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    /// The kube context name (unique key used everywhere in the app).
    pub name: String,
    pub cluster: String,
    pub user: String,
    /// Default namespace declared on the context, if any.
    pub namespace: Option<String>,
    /// API server URL.
    pub server: Option<String>,
    /// Whether this is the `current-context` in the kubeconfig.
    pub is_current: bool,
    /// True when this context authenticates through GKE / gcloud.
    pub is_gke: bool,
    /// Parsed GCP project (from `gke_<project>_<location>_<cluster>`).
    pub gke_project: Option<String>,
    pub gke_location: Option<String>,
    pub gke_cluster: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubeconfigSummary {
    /// Absolute path(s) that were merged to build this view.
    pub sources: Vec<String>,
    pub current_context: Option<String>,
    pub contexts: Vec<ContextInfo>,
}

/// Read and merge the kubeconfig from the default location and `KUBECONFIG`.
pub fn load_summary() -> AppResult<KubeconfigSummary> {
    let sources = kubeconfig_sources();

    let cfg = Kubeconfig::read()
        .map_err(|e| AppError::config(format!("Unable to read kubeconfig: {e}")))?;

    let current = cfg.current_context.clone();

    let contexts = cfg
        .contexts
        .iter()
        .map(|named| {
            let ctx = named.context.clone().unwrap_or_default();
            let user_name = ctx.user.clone();
            let cluster_name = ctx.cluster.clone();

            // Resolve the server URL from the referenced cluster entry.
            let server = cfg
                .clusters
                .iter()
                .find(|c| c.name == cluster_name)
                .and_then(|c| c.cluster.as_ref())
                .and_then(|c| c.server.clone());

            // GKE detection: either the exec plugin, or the canonical name.
            let auth_is_gke = cfg
                .auth_infos
                .iter()
                .find(|a| a.name == user_name)
                .and_then(|a| a.auth_info.as_ref())
                .and_then(|a| a.exec.as_ref())
                .map(|exec| {
                    exec.command
                        .as_deref()
                        .unwrap_or_default()
                        .contains("gke-gcloud-auth-plugin")
                        || exec
                            .args
                            .as_ref()
                            .map(|args| args.iter().any(|a| a.contains("gke")))
                            .unwrap_or(false)
                })
                .unwrap_or(false);

            let (gke_project, gke_location, gke_cluster) = parse_gke_name(&named.name);
            let is_gke = auth_is_gke || gke_project.is_some();

            ContextInfo {
                name: named.name.clone(),
                cluster: cluster_name,
                user: user_name,
                namespace: ctx.namespace.clone(),
                server,
                is_current: current.as_deref() == Some(named.name.as_str()),
                is_gke,
                gke_project,
                gke_location,
                gke_cluster,
            }
        })
        .collect();

    Ok(KubeconfigSummary {
        sources,
        current_context: current,
        contexts,
    })
}

/// List the files that make up the effective kubeconfig.
fn kubeconfig_sources() -> Vec<String> {
    if let Ok(env) = std::env::var("KUBECONFIG") {
        if !env.trim().is_empty() {
            let sep = if cfg!(windows) { ';' } else { ':' };
            return env
                .split(sep)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
        }
    }
    if let Some(home) = dirs::home_dir() {
        return vec![home
            .join(".kube")
            .join("config")
            .to_string_lossy()
            .into_owned()];
    }
    Vec::new()
}

/// GKE context names follow `gke_<project>_<location>_<cluster>`.
/// The cluster name itself may contain `-` but not `_`, so a simple split works.
fn parse_gke_name(name: &str) -> (Option<String>, Option<String>, Option<String>) {
    if let Some(rest) = name.strip_prefix("gke_") {
        let parts: Vec<&str> = rest.splitn(3, '_').collect();
        if parts.len() == 3 {
            return (
                Some(parts[0].to_string()),
                Some(parts[1].to_string()),
                Some(parts[2].to_string()),
            );
        }
    }
    (None, None, None)
}

#[cfg(test)]
mod tests {
    use super::parse_gke_name;

    #[test]
    fn parses_gke_context_names() {
        assert_eq!(
            parse_gke_name("gke_my-project_europe-west1_prod-cluster"),
            (
                Some("my-project".into()),
                Some("europe-west1".into()),
                Some("prod-cluster".into())
            )
        );
        assert_eq!(parse_gke_name("minikube"), (None, None, None));
        assert_eq!(parse_gke_name("gke_only_two"), (None, None, None));
    }
}
