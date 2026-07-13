//! In-pod filesystem browsing & editing via `kubectl exec`.
//!
//! Uses the kubectl CLI (already on PATH, handles auth) to list directories,
//! read a file, and write an edited file back into a running container. Needs a
//! shell + coreutils/busybox in the image (so not distroless).

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};

const MAX_READ_BYTES: usize = 2_000_000;

fn kubectl() -> &'static str {
    if cfg!(target_os = "windows") {
        "kubectl.exe"
    } else {
        "kubectl"
    }
}

fn exec_args(
    interactive: bool,
    context: &str,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
) -> Vec<String> {
    let mut a: Vec<String> = vec!["exec".into()];
    if interactive {
        a.push("-i".into());
    }
    a.push("--context".into());
    a.push(context.into());
    a.push("-n".into());
    a.push(namespace.into());
    a.push(pod.into());
    if let Some(c) = container {
        a.push("-c".into());
        a.push(c.into());
    }
    a.push("--".into());
    a
}

fn stderr_msg(out: &std::process::Output) -> String {
    let s = String::from_utf8_lossy(&out.stderr);
    if s.trim().is_empty() {
        "command failed".to_string()
    } else {
        s.trim().to_string()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
}

/// List a directory inside the container (`ls -Ap1 <path>`).
pub fn list_dir(
    context: &str,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    path: &str,
) -> AppResult<Vec<FileEntry>> {
    let mut args = exec_args(false, context, namespace, pod, container);
    args.push("ls".into());
    args.push("-Ap1".into());
    args.push(path.into());

    let out = Command::new(kubectl())
        .args(&args)
        .output()
        .map_err(|e| AppError::process(format!("kubectl not available: {e}")))?;
    if !out.status.success() {
        return Err(AppError::process(stderr_msg(&out)));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let is_dir = line.ends_with('/');
        let name = line.trim_end_matches('/').to_string();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        entries.push(FileEntry { name, is_dir });
    }
    // Directories first, then alphabetical.
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}

/// Read a (text) file from the container, capped at `MAX_READ_BYTES`.
pub fn read_file(
    context: &str,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    path: &str,
) -> AppResult<String> {
    let mut args = exec_args(false, context, namespace, pod, container);
    args.push("head".into());
    args.push("-c".into());
    args.push(MAX_READ_BYTES.to_string());
    args.push(path.into());

    let out = Command::new(kubectl())
        .args(&args)
        .output()
        .map_err(|e| AppError::process(format!("kubectl not available: {e}")))?;
    if !out.status.success() {
        return Err(AppError::process(stderr_msg(&out)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Write `content` back to `path` inside the container (`sh -c "cat > 'path'"`).
pub fn write_file(
    context: &str,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    path: &str,
    content: &str,
) -> AppResult<()> {
    let mut args = exec_args(true, context, namespace, pod, container);
    let escaped = path.replace('\'', "'\\''");
    args.push("sh".into());
    args.push("-c".into());
    args.push(format!("cat > '{escaped}'"));

    let mut child = Command::new(kubectl())
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::process(format!("kubectl not available: {e}")))?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::process("failed to open kubectl stdin"))?;
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| AppError::process(e.to_string()))?;
        // Dropping stdin closes it so `cat` terminates.
    }

    let out = child
        .wait_with_output()
        .map_err(|e| AppError::process(e.to_string()))?;
    if !out.status.success() {
        return Err(AppError::process(stderr_msg(&out)));
    }
    Ok(())
}
