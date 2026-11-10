//! API discovery: every listable resource kind the cluster serves (built-in
//! and CRDs), at each group's preferred version.
//!
//! Written by hand instead of `kube::Discovery::run` because that one queries
//! groups one by one and fails as a whole when a single aggregated API (often
//! `metrics.k8s.io` or a broken webhook-backed API) answers 503. Discovery
//! endpoints are readable by every authenticated user (`system:discovery`), so
//! this works with narrow RBAC too.

use crate::error::AppResult;
use crate::kube::client::ClientPool;
use futures::{stream, StreamExt};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::APIResourceList;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredResource {
    pub group: String,
    pub version: String,
    pub kind: String,
    pub plural: String,
    pub namespaced: bool,
    pub verbs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub resources: Vec<DiscoveredResource>,
    /// Group/versions that could not be queried (e.g. aggregated API down).
    pub failed: Vec<String>,
}

pub async fn discover(pool: &ClientPool, context: &str) -> AppResult<DiscoveryResult> {
    let client = pool.get(context).await?;
    let groups = client.list_api_groups().await?;

    let mut group_versions: Vec<String> = groups
        .groups
        .into_iter()
        .filter_map(|g| {
            g.preferred_version
                .map(|v| v.group_version)
                .or_else(|| g.versions.first().map(|v| v.group_version.clone()))
        })
        .collect();
    group_versions.push("v1".to_string());

    let lists: Vec<(String, Option<APIResourceList>)> = stream::iter(group_versions)
        .map(|gv| {
            let client = client.clone();
            async move {
                let res = if gv == "v1" {
                    client.list_core_api_resources("v1").await
                } else {
                    client.list_api_group_resources(&gv).await
                };
                (gv, res.ok())
            }
        })
        .buffer_unordered(16)
        .collect()
        .await;

    let mut resources = Vec::new();
    let mut failed = Vec::new();
    for (gv, list) in lists {
        let Some(list) = list else {
            failed.push(gv);
            continue;
        };
        let (group, version) = split_group_version(&list.group_version);
        for r in list.resources {
            // Subresources ("pods/log") and kinds that cannot be listed are not browsable.
            if r.name.contains('/') || !r.verbs.iter().any(|v| v == "list") {
                continue;
            }
            resources.push(DiscoveredResource {
                group: group.clone(),
                version: version.clone(),
                kind: r.kind,
                plural: r.name,
                namespaced: r.namespaced,
                verbs: r.verbs,
            });
        }
    }
    resources.sort_by(|a, b| (&a.group, &a.kind).cmp(&(&b.group, &b.kind)));
    failed.sort();
    Ok(DiscoveryResult { resources, failed })
}

fn split_group_version(gv: &str) -> (String, String) {
    match gv.split_once('/') {
        Some((g, v)) => (g.to_string(), v.to_string()),
        None => (String::new(), gv.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::split_group_version;

    #[test]
    fn splits_group_versions() {
        assert_eq!(split_group_version("v1"), (String::new(), "v1".into()));
        assert_eq!(
            split_group_version("networking.gke.io/v1beta1"),
            ("networking.gke.io".into(), "v1beta1".into())
        );
    }
}
