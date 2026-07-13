//! Launch the operating system's native terminal, pre-loaded with the current
//! cluster: it exports `KUBECONFIG` and runs `kubectl config use-context <ctx>`
//! on startup, then stays open for interactive use.

use crate::error::{AppError, AppResult};
use std::process::Command;

/// Resolve the kubeconfig path to hand to the spawned shell.
fn resolve_kubeconfig(explicit: Option<String>) -> String {
    if let Some(path) = explicit.filter(|p| !p.trim().is_empty()) {
        return path;
    }
    if let Ok(env) = std::env::var("KUBECONFIG") {
        if !env.trim().is_empty() {
            return env;
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".kube").join("config").to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn open_terminal(context: &str, kubeconfig: Option<String>) -> AppResult<()> {
    let kubeconfig = resolve_kubeconfig(kubeconfig);

    if cfg!(target_os = "windows") {
        open_windows(context, &kubeconfig)
    } else if cfg!(target_os = "macos") {
        open_macos(context, &kubeconfig)
    } else {
        open_linux(context, &kubeconfig)
    }
}

fn open_windows(context: &str, kubeconfig: &str) -> AppResult<()> {
    // IMPORTANT: `wt.exe` interprets `;` as its own command separator, so we
    // must NOT put `;` in the PowerShell command. We pass KUBECONFIG through the
    // process environment (inherited by the shell wt launches) and run a single
    // `;`-free command.
    let ps_cmd = format!(
        "kubectl config use-context '{}'",
        context.replace('\'', "''")
    );

    // Prefer Windows Terminal, fall back to a standalone PowerShell window.
    let wt = Command::new("wt.exe")
        .env("KUBECONFIG", kubeconfig)
        .args([
            "-w",
            "0",
            "nt",
            "powershell.exe",
            "-NoExit",
            "-Command",
            &ps_cmd,
        ])
        .spawn();

    if wt.is_ok() {
        return Ok(());
    }

    Command::new("cmd")
        .env("KUBECONFIG", kubeconfig)
        .args(["/C", "start", "", "powershell.exe", "-NoExit", "-Command", &ps_cmd])
        .spawn()
        .map_err(|e| AppError::process(format!("Failed to launch PowerShell: {e}")))?;
    Ok(())
}

fn open_macos(context: &str, kubeconfig: &str) -> AppResult<()> {
    let inner = format!(
        "export KUBECONFIG='{}'; kubectl config use-context '{}'",
        kubeconfig.replace('\'', "'\\''"),
        context.replace('\'', "'\\''")
    );
    // Prefer iTerm2 if present, else Terminal.app — both driven via AppleScript.
    let iterm = format!(
        r#"tell application "iTerm"
    create window with default profile
    tell current session of current window to write text "{}"
end tell"#,
        inner.replace('"', "\\\"")
    );
    if Command::new("osascript").args(["-e", &iterm]).spawn().is_ok() {
        return Ok(());
    }
    let terminal = format!(r#"tell application "Terminal" to do script "{}""#, inner.replace('"', "\\\""));
    Command::new("osascript")
        .args(["-e", &terminal])
        .spawn()
        .map_err(|e| AppError::process(format!("Failed to launch Terminal.app: {e}")))?;
    Ok(())
}

fn open_linux(context: &str, kubeconfig: &str) -> AppResult<()> {
    let inner = format!(
        "export KUBECONFIG='{}'; kubectl config use-context '{}'; exec $SHELL",
        kubeconfig.replace('\'', "'\\''"),
        context.replace('\'', "'\\''")
    );

    // Try the common terminal emulators in order of ubiquity.
    let candidates: &[(&str, Vec<String>)] = &[
        ("gnome-terminal", vec!["--".into(), "bash".into(), "-c".into(), inner.clone()]),
        ("konsole", vec!["-e".into(), "bash".into(), "-c".into(), inner.clone()]),
        ("alacritty", vec!["-e".into(), "bash".into(), "-c".into(), inner.clone()]),
        ("xterm", vec!["-e".into(), "bash".into(), "-c".into(), inner.clone()]),
    ];

    for (bin, args) in candidates {
        if Command::new(bin).args(args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(AppError::process(
        "No supported terminal emulator found (tried gnome-terminal, konsole, alacritty, xterm).",
    ))
}
