//! KubeNexus GKE — Tauri application entry point (library crate).

mod commands;
mod error;
mod gcp;
mod kube;
mod pod_fs;
mod pty;
mod state;
mod terminal;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install the rustls `ring` crypto provider as the process default *before*
    // kube constructs any TLS client. Otherwise kube 0.96 falls back to
    // aws-lc-rs, which fails the GKE TLS handshake on Windows.
    let _ = rustls::crypto::ring::default_provider().install_default();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,kubenexus_gke_lib=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_contexts,
            commands::check_tools,
            commands::set_kubeconfig_path,
            commands::invalidate_client,
            commands::list_resources,
            commands::get_resource_yaml,
            commands::get_resource_json,
            commands::apply_resource_yaml,
            commands::delete_resource,
            commands::scale_resource,
            commands::restart_resource,
            commands::node_usage,
            commands::pod_usage,
            commands::start_logs,
            commands::stop_logs,
            commands::start_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
            commands::open_terminal,
            commands::gcloud_login,
            commands::gcloud_check,
            commands::set_safe_mode,
            commands::get_safe_contexts,
            commands::write_text_file,
            commands::pty_open,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::pty_open_exec,
            commands::cordon_node,
            commands::drain_preview,
            commands::drain_node,
            commands::trigger_cronjob,
            commands::pod_list_dir,
            commands::pod_read_file,
            commands::pod_write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KubeNexus GKE");
}
