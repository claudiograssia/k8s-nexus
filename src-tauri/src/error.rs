//! Unified error type for all backend commands.
//!
//! Errors are serialized to the frontend as `{ kind, message }` so the UI can
//! react programmatically — most importantly to detect expired GKE tokens and
//! surface the "Re-authenticate with gcloud" action (auto-healing).

use serde::Serialize;

/// Machine-readable classification of a backend failure.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// A GKE / gcloud auth token expired or the `gke-gcloud-auth-plugin`
    /// failed. The frontend uses this to show the re-auth button.
    GkeAuth,
    /// Generic authentication / authorization failure (401/403).
    Auth,
    /// Requested resource / context was not found.
    NotFound,
    /// The kubeconfig could not be read or parsed.
    Config,
    /// A blocked write while Safe Mode (read-only) is active.
    SafeMode,
    /// Failure launching an external process (terminal, gcloud, ...).
    Process,
    /// Networking / API server connectivity failure.
    Connection,
    /// Anything else.
    Internal,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn config(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Config, message)
    }

    pub fn safe_mode() -> Self {
        Self::new(
            ErrorKind::SafeMode,
            "Safe Mode is active for this cluster — write operations are disabled.",
        )
    }

    pub fn process(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Process, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        classify(&e.to_string())
    }
}

impl From<kube::Error> for AppError {
    fn from(e: kube::Error) -> Self {
        // kube surfaces API status errors we can classify precisely.
        if let kube::Error::Api(status) = &e {
            let kind = match status.code {
                401 | 403 => ErrorKind::Auth,
                404 => ErrorKind::NotFound,
                _ => ErrorKind::Internal,
            };
            return AppError::new(kind, status.message.clone());
        }
        classify(&e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        classify(&e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::internal(format!("JSON error: {e}"))
    }
}

impl From<serde_yaml::Error> for AppError {
    fn from(e: serde_yaml::Error) -> Self {
        AppError::internal(format!("YAML error: {e}"))
    }
}

/// Best-effort classification of an opaque error message. The most important
/// job here is recognising expired GKE credentials so the UI can auto-heal.
pub fn classify(message: &str) -> AppError {
    let lower = message.to_lowercase();
    let is_gke = lower.contains("gke-gcloud-auth-plugin")
        || lower.contains("gcp-auth")
        || lower.contains("unable to retrieve token")
        || lower.contains("reauthentication failed")
        || lower.contains("gcloud")
        || (lower.contains("exec") && lower.contains("credential"));

    let kind = if is_gke {
        ErrorKind::GkeAuth
    } else if lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") {
        ErrorKind::Auth
    } else if lower.contains("not found") || lower.contains("404") {
        ErrorKind::NotFound
    } else if lower.contains("connection")
        || lower.contains("dial tcp")
        || lower.contains("timed out")
        || lower.contains("timeout")
    {
        ErrorKind::Connection
    } else {
        ErrorKind::Internal
    };

    AppError::new(kind, message.to_string())
}

pub type AppResult<T> = Result<T, AppError>;
