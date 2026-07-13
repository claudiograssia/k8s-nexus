//! Per-context Kubernetes client pool.
//!
//! Clients are built lazily from the merged kubeconfig for a given context and
//! cached. `kube` transparently drives exec credential plugins
//! (`gke-gcloud-auth-plugin`), so GKE contexts authenticate automatically as
//! long as `gcloud` is on the PATH.

use crate::error::{AppError, AppResult, ErrorKind};
use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::{Client, Config};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct ClientPool {
    inner: Arc<Mutex<HashMap<String, Client>>>,
}

impl ClientPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return a cached client for `context`, building one if necessary.
    pub async fn get(&self, context: &str) -> AppResult<Client> {
        if let Some(client) = self.inner.lock().get(context).cloned() {
            return Ok(client);
        }

        let client = build_client(context).await?;
        self.inner
            .lock()
            .insert(context.to_string(), client.clone());
        Ok(client)
    }

    /// Drop a cached client so the next call rebuilds it (used after re-auth).
    pub fn invalidate(&self, context: &str) {
        self.inner.lock().remove(context);
    }

    #[allow(dead_code)]
    pub fn invalidate_all(&self) {
        self.inner.lock().clear();
    }
}

async fn build_client(context: &str) -> AppResult<Client> {
    let kubeconfig = Kubeconfig::read()
        .map_err(|e| AppError::config(format!("Unable to read kubeconfig: {e}")))?;

    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        cluster: None,
        user: None,
    };

    let config = Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            let lower = msg.to_lowercase();
            if lower.contains("gke") || lower.contains("gcloud") || lower.contains("exec") {
                AppError::new(ErrorKind::GkeAuth, msg)
            } else {
                AppError::config(msg)
            }
        })?;

    Client::try_from(config).map_err(AppError::from)
}
