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
    /// Authentication failure (401): credentials missing or rejected.
    Auth,
    /// Authorization failure (403): authenticated, but RBAC / IAM denies the
    /// verb on this resource or namespace. Not fixed by refreshing the client.
    Forbidden,
    /// Requested resource / context was not found.
    NotFound,
    /// 409: a server-side apply would take over fields owned by another
    /// manager, or the object changed in the meantime.
    Conflict,
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
                401 => ErrorKind::Auth,
                403 => ErrorKind::Forbidden,
                404 => ErrorKind::NotFound,
                409 => ErrorKind::Conflict,
                _ => ErrorKind::Internal,
            };
            return AppError::new(kind, humanize(&status.message, Some(status.code)));
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
    } else if lower.contains("403") || lower.contains("forbidden") {
        ErrorKind::Forbidden
    } else if lower.contains("401") || lower.contains("unauthorized") {
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

    AppError::new(kind, humanize(message, None))
}

/// Turn a raw error body into something fit for a toast.
///
/// When the API server (or a proxy in front of it) answers with a non-JSON
/// body, kube-rs stores the whole body Debug-escaped in the message. GKE's
/// DNS-based control-plane endpoint (`*.gke.goog`) does exactly that on IAM
/// denials: it returns Google's HTML "Error 403 (Forbidden)" page.
pub fn humanize(message: &str, code: Option<u16>) -> String {
    let text = unescape_debug(message.trim());
    let lower = text.to_lowercase();
    if !(lower.contains("<html") || lower.contains("<!doctype")) {
        return text;
    }

    let is_google = lower.contains("google.com/images/errors") || lower.contains("that’s an error");
    let summary = html_summary(&text);
    let code = code.or_else(|| {
        regex::Regex::new(r"\b([45]\d\d)\b")
            .ok()?
            .captures(&summary)?
            .get(1)?
            .as_str()
            .parse()
            .ok()
    });

    if is_google && code == Some(403) {
        return format!(
            "403 Forbidden from Google's GKE endpoint: {summary} \
             The active gcloud account likely lacks the IAM permission \
             `container.clusters.connect` (e.g. role Kubernetes Engine Cluster Viewer), \
             required by the DNS-based control-plane endpoint."
        );
    }
    match code {
        Some(c) if !summary.starts_with(&c.to_string()) => format!("HTTP {c}: {summary}"),
        _ => summary,
    }
}

/// Undo the `{:?}` escaping kube-rs applies to unparseable error bodies.
fn unescape_debug(s: &str) -> String {
    let Some(inner) = s.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
        return s.to_string();
    };
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('0') => out.push('\0'),
            Some('u') => {
                // `\u{XXXX}`
                let hex: String = chars.by_ref().skip(1).take_while(|c| *c != '}').collect();
                if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
            }
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

/// Readable text of an HTML error page: `<title>` and `<style>` dropped,
/// tags stripped, whitespace collapsed, capped in length.
fn html_summary(html: &str) -> String {
    let drop_blocks = regex::Regex::new(r"(?is)<style[^>]*>.*?</style>|<script[^>]*>.*?</script>|<title[^>]*>.*?</title>|<head[^>]*>.*?</head>").unwrap();
    let tags = regex::Regex::new(r"(?s)<[^>]*>").unwrap();
    let ws = regex::Regex::new(r"\s+").unwrap();

    let body = drop_blocks.replace_all(html, " ");
    let body = tags.replace_all(&body, " ");
    let mut text = ws.replace_all(&body, " ").trim().to_string();
    // Google pages carry filler around the actual reason.
    text = text
        .replace("That’s all we know.", "")
        .replace("That’s an error.", "")
        .trim()
        .to_string();
    if let Some(rest) = regex::Regex::new(r"^\d{3}\.\s*").unwrap().find(&text).map(|m| text[m.end()..].to_string()) {
        text = rest;
    }
    if text.chars().count() > 300 {
        text = text.chars().take(300).collect::<String>() + "…";
    }
    if text.is_empty() {
        "the server returned an HTML error page".into()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn humanizes_google_403_page() {
        let body = "<!DOCTYPE html>\n<html lang=en>\n  <meta charset=utf-8>\n  <title>Error 403 (Forbidden)!!1</title>\n  <style>*{margin:0}</style>\n  <a href=//www.google.com/><span id=logo aria-label=Google></span></a>\n  <p><b>403.</b> <ins>That’s an error.</ins>\n  <p>Your client does not have permission to get URL <code>/api/v1/pods</code> from this server.  <ins>That’s all we know.</ins>\n";
        let msg = humanize(&format!("{body:?}"), Some(403));
        assert!(msg.starts_with("403 Forbidden from Google"), "{msg}");
        assert!(msg.contains("/api/v1/pods"), "{msg}");
        assert!(msg.contains("container.clusters.connect"), "{msg}");
        assert!(!msg.contains('<'), "{msg}");
    }

    #[test]
    fn leaves_plain_messages_alone() {
        assert_eq!(humanize("pods is forbidden", Some(403)), "pods is forbidden");
    }
}

pub type AppResult<T> = Result<T, AppError>;
