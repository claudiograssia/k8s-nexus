//! Shared application state held by Tauri and injected into every command.

use crate::error::{AppError, AppResult};
use crate::kube::client::ClientPool;
use crate::kube::logs::LogSessions;
use crate::kube::portforward::PortForwards;
use crate::pty::PtySessions;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub clients: ClientPool,
    pub logs: LogSessions,
    pub port_forwards: PortForwards,
    pub pty: PtySessions,
    /// Contexts locked into read-only (Safe Mode / prod lock).
    safe_contexts: Arc<Mutex<HashSet<String>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            clients: ClientPool::new(),
            logs: LogSessions::new(),
            port_forwards: PortForwards::new(),
            pty: PtySessions::new(),
            safe_contexts: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn set_safe_mode(&self, context: &str, enabled: bool) {
        let mut guard = self.safe_contexts.lock();
        if enabled {
            guard.insert(context.to_string());
        } else {
            guard.remove(context);
        }
    }

    pub fn is_safe(&self, context: &str) -> bool {
        self.safe_contexts.lock().contains(context)
    }

    pub fn safe_contexts(&self) -> Vec<String> {
        self.safe_contexts.lock().iter().cloned().collect()
    }

    /// Guard a write operation: errors if the context is in Safe Mode.
    pub fn ensure_writable(&self, context: &str) -> AppResult<()> {
        if self.is_safe(context) {
            Err(AppError::safe_mode())
        } else {
            Ok(())
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
