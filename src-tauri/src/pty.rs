//! Embedded terminal backend: real PTY sessions via `portable-pty`.
//!
//! Each session spawns the OS shell (PowerShell on Windows, `$SHELL`/bash on
//! Unix), pre-loaded with `KUBECONFIG` and `kubectl config use-context <ctx>`.
//! Output bytes are base64-encoded and streamed to the frontend (xterm.js) via
//! `pty://data` events; input/resize/close come back through commands.

use crate::error::{AppError, AppResult};
use base64::Engine;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct PtyOut {
    id: String,
    /// base64 of the raw terminal bytes (preserves multi-byte / ANSI data).
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: String,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct PtySessions {
    inner: Arc<Mutex<HashMap<String, Session>>>,
}

impl PtySessions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open an OS shell for a cluster (exports KUBECONFIG + `use-context`).
    pub fn open(
        &self,
        app: AppHandle,
        id: String,
        context: &str,
        kubeconfig: Option<&str>,
        rows: u16,
        cols: u16,
    ) -> AppResult<()> {
        let mut cmd = build_shell_command(context);
        if let Some(kc) = kubeconfig.filter(|s| !s.trim().is_empty()) {
            cmd.env("KUBECONFIG", kc);
        }
        self.spawn_in_pty(app, id, cmd, rows, cols)
    }

    /// Open an interactive `kubectl exec` (shell into a container) or
    /// `kubectl attach` (attach to the main process — for distroless images).
    #[allow(clippy::too_many_arguments)]
    pub fn open_exec(
        &self,
        app: AppHandle,
        id: String,
        context: &str,
        namespace: &str,
        pod: &str,
        container: Option<&str>,
        mode: &str,
        shell: Option<&str>,
        kubeconfig: Option<&str>,
        rows: u16,
        cols: u16,
    ) -> AppResult<()> {
        let mut cmd = build_kubectl_command(context, namespace, pod, container, mode, shell);
        if let Some(kc) = kubeconfig.filter(|s| !s.trim().is_empty()) {
            cmd.env("KUBECONFIG", kc);
        }
        self.spawn_in_pty(app, id, cmd, rows, cols)
    }

    fn spawn_in_pty(
        &self,
        app: AppHandle,
        id: String,
        cmd: CommandBuilder,
        rows: u16,
        cols: u16,
    ) -> AppResult<()> {
        // Replace an existing session with the same id.
        self.close(&id);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::process(format!("openpty failed: {e}")))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::process(format!("failed to spawn process: {e}")))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::process(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::process(e.to_string()))?;

        // Blocking reader → base64 → event stream.
        let app_reader = app.clone();
        let read_id = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app_reader.emit(
                            "pty://data",
                            PtyOut {
                                id: read_id.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
            let _ = app_reader.emit("pty://exit", PtyExit { id: read_id.clone() });
        });

        self.inner.lock().insert(
            id,
            Session {
                master: pair.master,
                writer,
                child,
            },
        );
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> AppResult<()> {
        let mut guard = self.inner.lock();
        let session = guard
            .get_mut(id)
            .ok_or_else(|| AppError::internal("terminal session not found"))?;
        session
            .writer
            .write_all(data)
            .map_err(|e| AppError::process(e.to_string()))?;
        let _ = session.writer.flush();
        Ok(())
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> AppResult<()> {
        let guard = self.inner.lock();
        let session = guard
            .get(id)
            .ok_or_else(|| AppError::internal("terminal session not found"))?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::process(e.to_string()))?;
        Ok(())
    }

    pub fn close(&self, id: &str) {
        if let Some(mut session) = self.inner.lock().remove(id) {
            let _ = session.child.kill();
        }
    }

    #[allow(dead_code)]
    pub fn close_all(&self) {
        let mut guard = self.inner.lock();
        for (_, mut session) in guard.drain() {
            let _ = session.child.kill();
        }
    }
}

/// Build `kubectl exec -it` (shell into a container) or `kubectl attach -it`
/// (attach to the running process), pinned to the given context/namespace.
fn build_kubectl_command(
    context: &str,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    mode: &str,
    shell: Option<&str>,
) -> CommandBuilder {
    let kubectl = if cfg!(target_os = "windows") {
        "kubectl.exe"
    } else {
        "kubectl"
    };
    let mut cmd = CommandBuilder::new(kubectl);
    let sub = if mode == "attach" { "attach" } else { "exec" };
    cmd.arg(sub);
    cmd.arg("-i");
    cmd.arg("-t");
    cmd.arg("--context");
    cmd.arg(context);
    cmd.arg("-n");
    cmd.arg(namespace);
    cmd.arg(pod);
    if let Some(c) = container {
        cmd.arg("-c");
        cmd.arg(c);
    }
    if sub == "exec" {
        cmd.arg("--");
        cmd.arg(shell.unwrap_or("/bin/sh"));
    }
    cmd
}

fn build_shell_command(context: &str) -> CommandBuilder {
    let ctx = context.replace('\'', "''");
    if cfg!(target_os = "windows") {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args([
            "-NoLogo",
            "-NoExit",
            "-Command",
            &format!("kubectl config use-context '{ctx}'"),
        ]);
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        let ctx_sh = context.replace('\'', "'\\''");
        let mut cmd = CommandBuilder::new(shell);
        cmd.args([
            "-lc",
            &format!("kubectl config use-context '{ctx_sh}'; exec \"$SHELL\""),
        ]);
        cmd
    }
}
