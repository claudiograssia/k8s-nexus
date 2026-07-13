//! Tauri command surface — the complete IPC contract consumed by the frontend.
//!
//! Write operations (`apply`, `delete`, `scale`, `restart`) are gated by Safe
//! Mode; read operations are always allowed.

use crate::error::{AppError, AppResult};
use crate::kube::config::KubeconfigSummary;
use crate::kube::logs::LogRequest;
use crate::kube::metrics::{NodeUsage, PodUsage};
use crate::kube::portforward::{PortForwardInfo, PortForwardRequest};
use crate::kube::resources::GvkSpec;
use crate::state::AppState;
use crate::{gcp, terminal};
use serde_json::Value;
use tauri::{AppHandle, State};

// ---------------------------------------------------------------------------
// Contexts / kubeconfig / tooling
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_contexts() -> AppResult<KubeconfigSummary> {
    // Blocking file IO — run off the async reactor.
    tokio::task::spawn_blocking(crate::kube::config::load_summary)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

/// Availability of the external CLIs the app relies on.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub kubectl: bool,
    pub gcloud: bool,
    pub gke_auth_plugin: bool,
}

fn tool_present(program: &str, args: &[&str]) -> bool {
    // `.output()` is Ok only if the binary was found and executed.
    std::process::Command::new(program).args(args).output().is_ok()
}

#[tauri::command]
pub async fn check_tools() -> AppResult<ToolStatus> {
    tokio::task::spawn_blocking(|| {
        // On Windows `gcloud` is a `.cmd`; CreateProcess only auto-appends `.exe`.
        let gcloud_bin = if cfg!(target_os = "windows") { "gcloud.cmd" } else { "gcloud" };
        ToolStatus {
            kubectl: tool_present("kubectl", &["version", "--client"]),
            gcloud: tool_present(gcloud_bin, &["version"]),
            gke_auth_plugin: tool_present("gke-gcloud-auth-plugin", &["--version"]),
        }
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))
}

/// Override the kubeconfig path (or clear it to fall back to the default
/// `~/.kube/config`). Implemented by setting the `KUBECONFIG` env var, which
/// every read path (config parsing, client build, terminals) already honors.
#[tauri::command]
pub async fn set_kubeconfig_path(
    state: State<'_, AppState>,
    path: Option<String>,
) -> AppResult<KubeconfigSummary> {
    match path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        Some(p) => std::env::set_var("KUBECONFIG", p),
        None => std::env::remove_var("KUBECONFIG"),
    }
    state.clients.invalidate_all();
    tokio::task::spawn_blocking(crate::kube::config::load_summary)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn invalidate_client(state: State<'_, AppState>, context: String) -> AppResult<()> {
    state.clients.invalidate(&context);
    Ok(())
}

// ---------------------------------------------------------------------------
// Generic resources
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_resources(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    namespace: Option<String>,
    label_selector: Option<String>,
) -> AppResult<Vec<Value>> {
    let st = state.inner().clone();
    crate::kube::resources::list(
        &st.clients,
        &context,
        &spec,
        namespace.as_deref(),
        label_selector.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn get_resource_yaml(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    namespace: Option<String>,
    name: String,
) -> AppResult<String> {
    let st = state.inner().clone();
    crate::kube::resources::get_yaml(&st.clients, &context, &spec, namespace.as_deref(), &name)
        .await
}

#[tauri::command]
pub async fn get_resource_json(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    namespace: Option<String>,
    name: String,
) -> AppResult<Value> {
    let st = state.inner().clone();
    crate::kube::resources::get_json(&st.clients, &context, &spec, namespace.as_deref(), &name)
        .await
}

#[tauri::command]
pub async fn apply_resource_yaml(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    yaml: String,
) -> AppResult<Value> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    crate::kube::resources::apply_yaml(&st.clients, &context, &spec, &yaml).await
}

#[tauri::command]
pub async fn delete_resource(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    namespace: Option<String>,
    name: String,
) -> AppResult<()> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    crate::kube::resources::delete(&st.clients, &context, &spec, namespace.as_deref(), &name).await
}

#[tauri::command]
pub async fn scale_resource(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    namespace: Option<String>,
    name: String,
    replicas: i32,
) -> AppResult<Value> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    crate::kube::resources::scale(
        &st.clients,
        &context,
        &spec,
        namespace.as_deref(),
        &name,
        replicas,
    )
    .await
}

#[tauri::command]
pub async fn restart_resource(
    state: State<'_, AppState>,
    context: String,
    spec: GvkSpec,
    namespace: Option<String>,
    name: String,
) -> AppResult<Value> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    crate::kube::resources::restart(&st.clients, &context, &spec, namespace.as_deref(), &name).await
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn node_usage(state: State<'_, AppState>, context: String) -> AppResult<Vec<NodeUsage>> {
    let st = state.inner().clone();
    crate::kube::metrics::node_usage(&st.clients, &context).await
}

#[tauri::command]
pub async fn pod_usage(
    state: State<'_, AppState>,
    context: String,
    namespace: Option<String>,
) -> AppResult<Vec<PodUsage>> {
    let st = state.inner().clone();
    crate::kube::metrics::pod_usage(&st.clients, &context, namespace.as_deref()).await
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_logs(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    request: LogRequest,
) -> AppResult<Vec<String>> {
    let st = state.inner().clone();
    crate::kube::logs::start_stream(app, &st.clients, &st.logs, session_id, request).await
}

#[tauri::command]
pub async fn stop_logs(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.logs.stop(&session_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Port-forward
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_port_forward(
    state: State<'_, AppState>,
    request: PortForwardRequest,
) -> AppResult<PortForwardInfo> {
    let st = state.inner().clone();
    st.port_forwards.start(&st.clients, request).await
}

#[tauri::command]
pub async fn stop_port_forward(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.port_forwards.stop(&id)
}

#[tauri::command]
pub async fn list_port_forwards(state: State<'_, AppState>) -> AppResult<Vec<PortForwardInfo>> {
    Ok(state.port_forwards.list())
}

// ---------------------------------------------------------------------------
// Terminal / GCP auto-healing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_terminal(context: String, kubeconfig: Option<String>) -> AppResult<()> {
    tokio::task::spawn_blocking(move || terminal::open_terminal(&context, kubeconfig))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn gcloud_login() -> AppResult<()> {
    tokio::task::spawn_blocking(gcp::gcloud_auth_login)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn gcloud_check() -> AppResult<String> {
    tokio::task::spawn_blocking(gcp::gcloud_refresh)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Embedded terminal (PTY)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    context: String,
    kubeconfig: Option<String>,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    state
        .pty
        .open(app, id, &context, kubeconfig.as_deref(), rows, cols)
}

#[tauri::command]
pub async fn pty_write(state: State<'_, AppState>, id: String, data: String) -> AppResult<()> {
    state.pty.write(&id, data.as_bytes())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    state.pty.resize(&id, rows, cols)
}

#[tauri::command]
pub async fn pty_close(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.pty.close(&id);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_open_exec(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    mode: String,
    shell: Option<String>,
    kubeconfig: Option<String>,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    state.pty.open_exec(
        app,
        id,
        &context,
        &namespace,
        &pod,
        container.as_deref(),
        &mode,
        shell.as_deref(),
        kubeconfig.as_deref(),
        rows,
        cols,
    )
}

// ---------------------------------------------------------------------------
// In-pod filesystem (browse / read / write via kubectl exec)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pod_list_dir(
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
) -> AppResult<Vec<crate::pod_fs::FileEntry>> {
    tokio::task::spawn_blocking(move || {
        crate::pod_fs::list_dir(&context, &namespace, &pod, container.as_deref(), &path)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn pod_read_file(
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
) -> AppResult<String> {
    tokio::task::spawn_blocking(move || {
        crate::pod_fs::read_file(&context, &namespace, &pod, container.as_deref(), &path)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn pod_write_file(
    state: State<'_, AppState>,
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    content: String,
) -> AppResult<()> {
    state.ensure_writable(&context)?;
    tokio::task::spawn_blocking(move || {
        crate::pod_fs::write_file(&context, &namespace, &pod, container.as_deref(), &path, &content)
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Node ops (cordon / drain) & CronJob trigger
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn cordon_node(
    state: State<'_, AppState>,
    context: String,
    node: String,
    on: bool,
) -> AppResult<()> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    crate::kube::ops::set_cordon(&st.clients, &context, &node, on).await
}

#[tauri::command]
pub async fn drain_preview(
    state: State<'_, AppState>,
    context: String,
    node: String,
) -> AppResult<Vec<crate::kube::ops::DrainPod>> {
    let st = state.inner().clone();
    crate::kube::ops::drain_preview(&st.clients, &context, &node).await
}

#[tauri::command]
pub async fn drain_node(
    state: State<'_, AppState>,
    context: String,
    node: String,
) -> AppResult<usize> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    crate::kube::ops::drain(&st.clients, &context, &node).await
}

#[tauri::command]
pub async fn trigger_cronjob(
    state: State<'_, AppState>,
    context: String,
    namespace: String,
    name: String,
) -> AppResult<String> {
    state.ensure_writable(&context)?;
    let st = state.inner().clone();
    let suffix = chrono::Utc::now().timestamp().to_string();
    crate::kube::ops::trigger_cronjob(&st.clients, &context, &namespace, &name, &suffix).await
}

// ---------------------------------------------------------------------------
// Safe Mode
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn set_safe_mode(
    state: State<'_, AppState>,
    context: String,
    enabled: bool,
) -> AppResult<()> {
    state.set_safe_mode(&context, enabled);
    Ok(())
}

#[tauri::command]
pub async fn get_safe_contexts(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.safe_contexts())
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/// Write a UTF-8 text file (used to export filtered logs chosen via the dialog).
#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || std::fs::write(&path, contents))
        .await
        .map_err(|e| AppError::internal(e.to_string()))??;
    Ok(())
}
