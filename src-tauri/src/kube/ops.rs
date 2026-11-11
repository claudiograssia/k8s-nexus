//! Higher-level cluster operations: node cordon/drain and CronJob trigger.

use crate::error::{AppError, AppResult};
use crate::kube::client::ClientPool;
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{Node, Pod};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::api::{Api, DeleteParams, EvictParams, ListParams, Patch, PatchParams, PostParams};
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;

/// Cordon (`on = true`) or uncordon a node by toggling `spec.unschedulable`.
pub async fn set_cordon(pool: &ClientPool, context: &str, node: &str, on: bool) -> AppResult<()> {
    let client = pool.get(context).await?;
    let nodes: Api<Node> = Api::all(client);
    let patch = json!({ "spec": { "unschedulable": on } });
    nodes
        .patch(node, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainPod {
    pub namespace: String,
    pub name: String,
    /// Owning controller kind (Deployment via ReplicaSet, StatefulSet, …) or "".
    pub controller: String,
}

/// List the pods that a drain would evict from `node`: everything scheduled
/// there except DaemonSet-managed pods and static/mirror pods.
pub async fn drain_preview(
    pool: &ClientPool,
    context: &str,
    node: &str,
) -> AppResult<Vec<DrainPod>> {
    let client = pool.get(context).await?;
    let pods: Api<Pod> = Api::all(client);
    let lp = ListParams::default().fields(&format!("spec.nodeName={node}"));
    let list = pods.list(&lp).await?;

    let mut out = Vec::new();
    for p in list {
        let annotations = p.metadata.annotations.clone().unwrap_or_default();
        // Skip static / mirror pods — they cannot be evicted.
        if annotations.contains_key("kubernetes.io/config.mirror") {
            continue;
        }
        let owner = p
            .metadata
            .owner_references
            .as_ref()
            .and_then(|o| o.first())
            .map(|o| o.kind.clone())
            .unwrap_or_default();
        // DaemonSet pods are managed per-node and are not drained.
        if owner == "DaemonSet" {
            continue;
        }
        out.push(DrainPod {
            namespace: p.metadata.namespace.clone().unwrap_or_default(),
            name: p.metadata.name.clone().unwrap_or_default(),
            controller: owner,
        });
    }
    Ok(out)
}

/// Cordon the node, then evict every drainable pod (falling back to delete if
/// the eviction subresource is unavailable). Returns how many were evicted.
pub async fn drain(pool: &ClientPool, context: &str, node: &str) -> AppResult<usize> {
    set_cordon(pool, context, node, true).await?;
    let targets = drain_preview(pool, context, node).await?;
    let client = pool.get(context).await?;

    let mut count = 0usize;
    for t in &targets {
        let api: Api<Pod> = Api::namespaced(client.clone(), &t.namespace);
        match api.evict(&t.name, &EvictParams::default()).await {
            Ok(_) => count += 1,
            Err(_) => {
                if api.delete(&t.name, &DeleteParams::default()).await.is_ok() {
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

/// Manually trigger a CronJob now by creating a Job from its `jobTemplate`
/// (equivalent to `kubectl create job --from=cronjob/<name>`).
pub async fn trigger_cronjob(
    pool: &ClientPool,
    context: &str,
    namespace: &str,
    name: &str,
    suffix: &str,
) -> AppResult<String> {
    let client = pool.get(context).await?;
    let cronjobs: Api<CronJob> = Api::namespaced(client.clone(), namespace);
    let cj = cronjobs.get(name).await?;

    let template = cj
        .spec
        .and_then(|s| s.job_template.spec)
        .ok_or_else(|| AppError::internal("CronJob has no jobTemplate.spec"))?;

    let job_name = format!("{name}-manual-{suffix}");
    let mut annotations = BTreeMap::new();
    annotations.insert(
        "cronjob.kubernetes.io/instantiate".to_string(),
        "manual".to_string(),
    );

    let job = Job {
        metadata: ObjectMeta {
            name: Some(job_name.clone()),
            namespace: Some(namespace.to_string()),
            annotations: Some(annotations),
            ..Default::default()
        },
        spec: Some(template),
        ..Default::default()
    };

    let jobs: Api<Job> = Api::namespaced(client, namespace);
    jobs.create(&PostParams::default(), &job).await?;
    Ok(job_name)
}
