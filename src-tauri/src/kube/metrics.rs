//! `metrics.k8s.io` (metrics-server) integration plus Kubernetes quantity
//! parsing. Powers the dashboard charts and the FinOps / right-sizing tables.

use crate::error::AppResult;
use crate::kube::client::ClientPool;
use crate::kube::resources::GvkSpec;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeUsage {
    pub name: String,
    /// CPU usage in millicores.
    pub cpu_milli: f64,
    /// Memory usage in bytes.
    pub memory_bytes: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerUsage {
    pub name: String,
    pub cpu_milli: f64,
    pub memory_bytes: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodUsage {
    pub name: String,
    pub namespace: String,
    pub cpu_milli: f64,
    pub memory_bytes: f64,
    pub containers: Vec<ContainerUsage>,
}

fn node_metrics_gvk() -> GvkSpec {
    GvkSpec {
        group: "metrics.k8s.io".into(),
        version: "v1beta1".into(),
        kind: "NodeMetrics".into(),
        plural: "nodes".into(),
        namespaced: false,
    }
}

fn pod_metrics_gvk() -> GvkSpec {
    GvkSpec {
        group: "metrics.k8s.io".into(),
        version: "v1beta1".into(),
        kind: "PodMetrics".into(),
        plural: "pods".into(),
        namespaced: true,
    }
}

pub async fn node_usage(pool: &ClientPool, context: &str) -> AppResult<Vec<NodeUsage>> {
    let items = crate::kube::resources::list(pool, context, &node_metrics_gvk(), None, None).await?;
    Ok(items
        .into_iter()
        .filter_map(|item| {
            let name = item.pointer("/metadata/name")?.as_str()?.to_string();
            let usage = item.get("usage")?;
            Some(NodeUsage {
                name,
                cpu_milli: parse_cpu(usage.get("cpu")),
                memory_bytes: parse_memory(usage.get("memory")),
            })
        })
        .collect())
}

pub async fn pod_usage(
    pool: &ClientPool,
    context: &str,
    namespace: Option<&str>,
) -> AppResult<Vec<PodUsage>> {
    let items =
        crate::kube::resources::list(pool, context, &pod_metrics_gvk(), namespace, None).await?;
    Ok(items
        .into_iter()
        .filter_map(|item| {
            let name = item.pointer("/metadata/name")?.as_str()?.to_string();
            let namespace = item
                .pointer("/metadata/namespace")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();

            let mut containers = Vec::new();
            let mut cpu_total = 0.0;
            let mut mem_total = 0.0;
            if let Some(list) = item.get("containers").and_then(|c| c.as_array()) {
                for c in list {
                    let cname = c
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    let usage = c.get("usage");
                    let cpu = parse_cpu(usage.and_then(|u| u.get("cpu")));
                    let mem = parse_memory(usage.and_then(|u| u.get("memory")));
                    cpu_total += cpu;
                    mem_total += mem;
                    containers.push(ContainerUsage {
                        name: cname,
                        cpu_milli: cpu,
                        memory_bytes: mem,
                    });
                }
            }

            Some(PodUsage {
                name,
                namespace,
                cpu_milli: cpu_total,
                memory_bytes: mem_total,
                containers,
            })
        })
        .collect())
}

/// Parse a Kubernetes CPU quantity into millicores.
/// Handles `"100m"`, `"1"`, `"1500m"`, `"250000000n"`, `"1500u"`.
pub fn parse_cpu(v: Option<&Value>) -> f64 {
    let s = match v.and_then(|v| v.as_str()) {
        Some(s) => s.trim(),
        None => return 0.0,
    };
    if s.is_empty() {
        return 0.0;
    }
    if let Some(num) = s.strip_suffix('n') {
        return num.parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
    }
    if let Some(num) = s.strip_suffix('u') {
        return num.parse::<f64>().unwrap_or(0.0) / 1_000.0;
    }
    if let Some(num) = s.strip_suffix('m') {
        return num.parse::<f64>().unwrap_or(0.0);
    }
    // Whole cores.
    s.parse::<f64>().unwrap_or(0.0) * 1000.0
}

/// Parse a Kubernetes memory quantity into bytes.
/// Handles binary (Ki/Mi/Gi/Ti/Pi/Ei) and decimal (k/M/G/T/P/E) suffixes.
pub fn parse_memory(v: Option<&Value>) -> f64 {
    let s = match v.and_then(|v| v.as_str()) {
        Some(s) => s.trim(),
        None => return 0.0,
    };
    if s.is_empty() {
        return 0.0;
    }

    let binary = [
        ("Ki", 1024f64.powi(1)),
        ("Mi", 1024f64.powi(2)),
        ("Gi", 1024f64.powi(3)),
        ("Ti", 1024f64.powi(4)),
        ("Pi", 1024f64.powi(5)),
        ("Ei", 1024f64.powi(6)),
    ];
    for (suffix, factor) in binary {
        if let Some(num) = s.strip_suffix(suffix) {
            return num.parse::<f64>().unwrap_or(0.0) * factor;
        }
    }

    let decimal = [
        ("k", 1e3),
        ("M", 1e6),
        ("G", 1e9),
        ("T", 1e12),
        ("P", 1e15),
        ("E", 1e18),
    ];
    for (suffix, factor) in decimal {
        if let Some(num) = s.strip_suffix(suffix) {
            return num.parse::<f64>().unwrap_or(0.0) * factor;
        }
    }

    // Plain bytes (possibly with fractional exponent form).
    s.parse::<f64>().unwrap_or(0.0)
}
