//! Permission probing via `SelfSubjectAccessReview`.
//!
//! The UI asks "can I <verb> <resource> in <namespace>?" before showing an
//! action. SSAR is the only reliable source on GKE: it goes through every
//! authorizer, including the IAM webhook, whereas `SelfSubjectRulesReview`
//! only reports RBAC rules and comes back `incomplete`.

use crate::error::AppResult;
use crate::kube::client::ClientPool;
use futures::{stream, StreamExt};
use k8s_openapi::api::authorization::v1::{
    ResourceAttributes, SelfSubjectAccessReview, SelfSubjectAccessReviewSpec,
};
use kube::api::{Api, PostParams};
use serde::Deserialize;

/// One question, mirroring `kubectl auth can-i`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessCheck {
    #[serde(default)]
    pub group: String,
    pub resource: String,
    #[serde(default)]
    pub subresource: Option<String>,
    pub verb: String,
    /// `None` / empty = cluster-wide (all namespaces).
    #[serde(default)]
    pub namespace: Option<String>,
}

/// Answer a batch of checks, in order. A check whose review request itself
/// fails comes back `None` (unknown); if every one fails, the first error is
/// returned instead so the caller sees why (e.g. the cluster is unreachable).
pub async fn check(
    pool: &ClientPool,
    context: &str,
    checks: Vec<AccessCheck>,
) -> AppResult<Vec<Option<bool>>> {
    if checks.is_empty() {
        return Ok(Vec::new());
    }
    let client = pool.get(context).await?;
    let api: Api<SelfSubjectAccessReview> = Api::all(client);

    let results: Vec<AppResult<bool>> = stream::iter(checks)
        .map(|c| {
            let api = api.clone();
            async move {
                let review = SelfSubjectAccessReview {
                    spec: SelfSubjectAccessReviewSpec {
                        resource_attributes: Some(ResourceAttributes {
                            group: Some(c.group),
                            resource: Some(c.resource),
                            subresource: c.subresource.filter(|s| !s.is_empty()),
                            verb: Some(c.verb),
                            namespace: c.namespace.filter(|n| !n.is_empty()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let out = api.create(&PostParams::default(), &review).await?;
                Ok(out.status.map(|s| s.allowed).unwrap_or(false))
            }
        })
        .buffered(8)
        .collect()
        .await;

    if results.iter().all(|r| r.is_err()) {
        if let Some(Err(e)) = results.into_iter().next() {
            return Err(e);
        }
        return Ok(Vec::new());
    }
    Ok(results.into_iter().map(|r| r.ok()).collect())
}
