//! GCP / gcloud helpers driving the GKE token auto-healing flow.
//!
//! When a call fails with an expired GKE token, the UI offers a button that
//! runs `gcloud auth login` in a native terminal; afterwards the client pool is
//! invalidated so the next request rebuilds a freshly-authenticated client.

use crate::error::{AppError, AppResult};
use std::process::Command;

/// Launch an interactive `gcloud auth login` in the system terminal.
/// Interactive because the flow opens a browser and waits for consent.
pub fn gcloud_auth_login() -> AppResult<()> {
    if cfg!(target_os = "windows") {
        let cmd = "gcloud auth login";
        let wt = Command::new("wt.exe")
            .args(["-w", "0", "nt", "powershell.exe", "-NoExit", "-Command", cmd])
            .spawn();
        if wt.is_ok() {
            return Ok(());
        }
        Command::new("cmd")
            .args(["/C", "start", "powershell.exe", "-NoExit", "-Command", cmd])
            .spawn()
            .map_err(|e| AppError::process(format!("Failed to launch gcloud auth: {e}")))?;
        Ok(())
    } else if cfg!(target_os = "macos") {
        let script = r#"tell application "Terminal" to do script "gcloud auth login""#;
        Command::new("osascript")
            .args(["-e", script])
            .spawn()
            .map_err(|e| AppError::process(format!("Failed to launch gcloud auth: {e}")))?;
        Ok(())
    } else {
        let inner = "gcloud auth login; exec $SHELL";
        for bin in ["gnome-terminal", "konsole", "alacritty", "xterm"] {
            let args: Vec<&str> = if bin == "gnome-terminal" {
                vec!["--", "bash", "-c", inner]
            } else {
                vec!["-e", "bash", "-c", inner]
            };
            if Command::new(bin).args(args).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(AppError::process("No terminal emulator available for gcloud auth."))
    }
}

/// Refresh application-default / GKE credentials non-interactively where
/// possible (used after the user completes the browser login).
pub fn gcloud_refresh() -> AppResult<String> {
    let output = Command::new(gcloud_bin())
        .args(["auth", "print-access-token"])
        .output()
        .map_err(|e| AppError::process(format!("gcloud not found: {e}")))?;

    if output.status.success() {
        Ok("Credentials are valid.".to_string())
    } else {
        Err(AppError::new(
            crate::error::ErrorKind::GkeAuth,
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

fn gcloud_bin() -> &'static str {
    if cfg!(target_os = "windows") {
        "gcloud.cmd"
    } else {
        "gcloud"
    }
}
