//! Generic, GVK-driven resource operations built on `kube`'s dynamic API.
//!
//! One code path handles every Kubernetes object — built-in workloads *and*
//! GKE CRDs (BackendConfig, Gateway, HTTPRoute, VolumeSnapshot, …) — because
//! the caller supplies the Group/Version/Kind + plural + scope.

use crate::error::{AppError, AppResult};
use crate::kube::client::ClientPool;
use chrono::Utc;
use kube::api::{
    Api, ApiResource, DeleteParams, DynamicObject, GroupVersionKind, ListParams, Patch,
    PatchParams,
};
use serde::Deserialize;
use serde_json::{json, Value};

/// Identifies a kind of resource to operate on, supplied by the frontend
/// registry (which knows the correct plural + scope for every kind we expose).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GvkSpec {
    #[serde(default)]
    pub group: String,
    pub version: String,
    pub kind: String,
    pub plural: String,
    pub namespaced: bool,
}

impl GvkSpec {
    fn api_resource(&self) -> ApiResource {
        let gvk = GroupVersionKind::gvk(&self.group, &self.version, &self.kind);
        let mut ar = ApiResource::from_gvk(&gvk);
        // Trust the explicit plural from the registry (ApiResource::from_gvk
        // only guesses it) so CRDs with irregular plurals resolve correctly.
        ar.plural = self.plural.clone();
        ar
    }
}

pub(crate) fn api_for(
    pool_client: kube::Client,
    spec: &GvkSpec,
    namespace: Option<&str>,
) -> Api<DynamicObject> {
    let ar = spec.api_resource();
    if spec.namespaced {
        match namespace {
            Some(ns) if !ns.is_empty() && ns != "*" => {
                Api::namespaced_with(pool_client, ns, &ar)
            }
            _ => Api::all_with(pool_client, &ar),
        }
    } else {
        Api::all_with(pool_client, &ar)
    }
}

/// List every object of a kind (optionally scoped to a namespace and/or a
/// label selector). Returns raw manifests as JSON — the frontend derives the
/// columns it needs from `metadata`, `status`, and `spec`.
pub async fn list(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    namespace: Option<&str>,
    label_selector: Option<&str>,
    field_selector: Option<&str>,
) -> AppResult<Vec<Value>> {
    let client = pool.get(context).await?;
    let api = api_for(client, spec, namespace);

    let mut lp = ListParams::default();
    if let Some(sel) = label_selector.filter(|s| !s.is_empty()) {
        lp = lp.labels(sel);
    }
    if let Some(sel) = field_selector.filter(|s| !s.is_empty()) {
        lp = lp.fields(sel);
    }

    let list = api.list(&lp).await?;
    let items = list
        .items
        .into_iter()
        .map(|obj| serde_json::to_value(obj).unwrap_or(Value::Null))
        .collect();
    Ok(items)
}

/// Fetch a single object as its full JSON manifest.
pub async fn get_json(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    namespace: Option<&str>,
    name: &str,
) -> AppResult<Value> {
    let client = pool.get(context).await?;
    let api = api_for(client, spec, namespace);
    let obj = api.get(name).await?;
    Ok(serde_json::to_value(obj)?)
}

/// Fetch a single object as a YAML string (for the Monaco editor).
pub async fn get_yaml(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    namespace: Option<&str>,
    name: &str,
) -> AppResult<String> {
    let value = get_json(pool, context, spec, namespace, name).await?;
    let sanitized = strip_noise(value);
    Ok(serde_yaml::to_string(&sanitized)?)
}

/// Server-side apply an edited YAML document back to the cluster.
///
/// Without `force`, changing a field owned by another manager (Helm, Argo CD,
/// kubectl, a controller) fails with a 409 listing the conflicts, so the user
/// can decide whether to take ownership.
pub async fn apply_yaml(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    yaml: &str,
    force: bool,
) -> AppResult<Value> {
    let obj: DynamicObject = serde_yaml::from_str(yaml)
        .map_err(|e| AppError::internal(format!("Invalid YAML: {e}")))?;

    let name = obj
        .metadata
        .name
        .clone()
        .ok_or_else(|| AppError::internal("Manifest is missing metadata.name"))?;
    let namespace = obj.metadata.namespace.clone();

    let client = pool.get(context).await?;
    let api = api_for(client, spec, namespace.as_deref());

    let mut pp = PatchParams::apply("kubenexus-gke");
    if force {
        pp = pp.force();
    }
    let applied = api.patch(&name, &pp, &Patch::Apply(&obj)).await?;
    Ok(serde_json::to_value(applied)?)
}

/// Delete an object.
pub async fn delete(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    namespace: Option<&str>,
    name: &str,
) -> AppResult<()> {
    let client = pool.get(context).await?;
    let api = api_for(client, spec, namespace);
    api.delete(name, &DeleteParams::default()).await?;
    Ok(())
}

/// Scale a workload by patching `spec.replicas`.
pub async fn scale(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    namespace: Option<&str>,
    name: &str,
    replicas: i32,
) -> AppResult<Value> {
    let client = pool.get(context).await?;
    let api = api_for(client, spec, namespace);
    let patch = json!({ "spec": { "replicas": replicas } });
    let out = api
        .patch(name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;
    Ok(serde_json::to_value(out)?)
}

/// Trigger a rolling restart by stamping the pod template annotation that
/// `kubectl rollout restart` uses.
pub async fn restart(
    pool: &ClientPool,
    context: &str,
    spec: &GvkSpec,
    namespace: Option<&str>,
    name: &str,
) -> AppResult<Value> {
    let client = pool.get(context).await?;
    let api = api_for(client, spec, namespace);
    let now = Utc::now().to_rfc3339();
    let patch = json!({
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "kubectl.kubernetes.io/restartedAt": now
                    }
                }
            }
        }
    });
    let out = api
        .patch(name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;
    Ok(serde_json::to_value(out)?)
}

/// Remove server-managed noise from a manifest before showing it in the editor,
/// mirroring what `kubectl edit` hides.
fn strip_noise(mut value: Value) -> Value {
    if let Some(meta) = value.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        meta.remove("managedFields");
        meta.remove("generation");
        meta.remove("resourceVersion");
        meta.remove("uid");
        meta.remove("creationTimestamp");
        meta.remove("selfLink");
        if let Some(ann) = meta.get_mut("annotations").and_then(|a| a.as_object_mut()) {
            ann.remove("kubectl.kubernetes.io/last-applied-configuration");
            if ann.is_empty() {
                meta.remove("annotations");
            }
        }
    }
    value
}
