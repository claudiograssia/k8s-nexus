//! Local `kubectl port-forward`-style manager.
//!
//! Each active forward binds a local TCP listener and pipes every accepted
//! connection to the target pod port through `kube`'s portforward channel.

use crate::error::{AppError, AppResult};
use crate::kube::client::ClientPool;
use k8s_openapi::api::core::v1::Pod;
use kube::api::Api;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardRequest {
    pub context: String,
    pub namespace: String,
    pub pod: String,
    pub remote_port: u16,
    /// 0 lets the OS choose a free local port.
    #[serde(default)]
    pub local_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardInfo {
    pub id: String,
    pub context: String,
    pub namespace: String,
    pub pod: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub local_url: String,
}

struct Entry {
    handle: JoinHandle<()>,
    info: PortForwardInfo,
}

#[derive(Clone, Default)]
pub struct PortForwards {
    inner: Arc<Mutex<HashMap<String, Entry>>>,
}

impl PortForwards {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start(
        &self,
        pool: &ClientPool,
        req: PortForwardRequest,
    ) -> AppResult<PortForwardInfo> {
        let client = pool.get(&req.context).await?;

        let listener = TcpListener::bind(("127.0.0.1", req.local_port))
            .await
            .map_err(|e| AppError::internal(format!("Cannot bind local port: {e}")))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| AppError::internal(e.to_string()))?
            .port();

        let id = Uuid::new_v4().to_string();
        let info = PortForwardInfo {
            id: id.clone(),
            context: req.context.clone(),
            namespace: req.namespace.clone(),
            pod: req.pod.clone(),
            remote_port: req.remote_port,
            local_port,
            local_url: format!("http://127.0.0.1:{local_port}"),
        };

        let pods: Api<Pod> = Api::namespaced(client, &req.namespace);
        let pod = req.pod.clone();
        let remote = req.remote_port;

        let handle = tokio::spawn(async move {
            loop {
                let (mut client_conn, _addr) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(_) => break,
                };
                let pods = pods.clone();
                let pod = pod.clone();
                tokio::spawn(async move {
                    let mut forwarder = match pods.portforward(&pod, &[remote]).await {
                        Ok(f) => f,
                        Err(_) => return,
                    };
                    if let Some(mut upstream) = forwarder.take_stream(remote) {
                        let _ =
                            tokio::io::copy_bidirectional(&mut client_conn, &mut upstream).await;
                    }
                    let _ = forwarder.join().await;
                });
            }
        });

        self.inner.lock().insert(
            id,
            Entry {
                handle,
                info: info.clone(),
            },
        );
        Ok(info)
    }

    pub fn stop(&self, id: &str) -> AppResult<()> {
        match self.inner.lock().remove(id) {
            Some(entry) => {
                entry.handle.abort();
                Ok(())
            }
            None => Err(AppError::internal("Port-forward not found")),
        }
    }

    pub fn list(&self) -> Vec<PortForwardInfo> {
        self.inner
            .lock()
            .values()
            .map(|e| e.info.clone())
            .collect()
    }

    #[allow(dead_code)]
    pub fn stop_all(&self) {
        let mut guard = self.inner.lock();
        for (_, entry) in guard.drain() {
            entry.handle.abort();
        }
    }
}
