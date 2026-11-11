//! On macOS an app started from Finder or the Dock gets a minimal `PATH`
//! (`/usr/bin:/bin:/usr/sbin:/sbin`), so `kubectl`, `gcloud` and
//! `gke-gcloud-auth-plugin` installed with Homebrew or the Cloud SDK installer
//! are not found. At startup we ask the user's login shell for its `PATH` and
//! add the usual install locations as a fallback.

use std::path::PathBuf;

/// Directories where the CLI tools usually live on macOS.
fn common_dirs(home: Option<PathBuf>) -> Vec<String> {
    let mut dirs = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/share/google-cloud-sdk/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/share/google-cloud-sdk/bin".to_string(),
    ];
    if let Some(home) = home {
        dirs.push(
            home.join("google-cloud-sdk/bin")
                .to_string_lossy()
                .into_owned(),
        );
        dirs.push(home.join(".local/bin").to_string_lossy().into_owned());
    }
    dirs
}

/// Join PATH lists, keeping the first occurrence of each entry.
fn merge_paths(lists: &[&str]) -> String {
    let mut seen = std::collections::HashSet::new();
    lists
        .iter()
        .flat_map(|l| l.split(':'))
        .filter(|p| !p.is_empty() && seen.insert(p.to_string()))
        .collect::<Vec<_>>()
        .join(":")
}

/// `PATH` as seen by an interactive login shell, if it answers in time.
#[cfg(target_os = "macos")]
fn login_shell_path() -> Option<String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", "printf '__PATH__%s' \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // A slow or broken shell profile must not block the app start.
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let out = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    // Profiles may print banners: keep only what follows the marker.
    let path = text.rsplit_once("__PATH__")?.1.trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Make the CLI tools findable. Call before any thread is spawned.
pub fn fix_path() {
    #[cfg(target_os = "macos")]
    {
        let current = std::env::var("PATH").unwrap_or_default();
        let shell = login_shell_path().unwrap_or_default();
        let extra = common_dirs(dirs::home_dir()).join(":");
        std::env::set_var("PATH", merge_paths(&[&shell, &current, &extra]));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (common_dirs, merge_paths);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_without_duplicates_in_order() {
        assert_eq!(
            merge_paths(&[
                "/opt/homebrew/bin:/usr/bin",
                "/usr/bin:/bin:",
                "/bin:/usr/local/bin"
            ]),
            "/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin"
        );
        assert_eq!(merge_paths(&["", ""]), "");
    }

    #[test]
    fn includes_the_cloud_sdk_in_home() {
        let dirs = common_dirs(Some(PathBuf::from("/Users/me")));
        assert!(dirs.contains(&"/Users/me/google-cloud-sdk/bin".to_string()));
        assert!(dirs.contains(&"/opt/homebrew/bin".to_string()));
    }
}
