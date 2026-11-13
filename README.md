# KubeNexus GKE

An ultra-fast, production-grade **desktop IDE for multi-cluster Kubernetes**, built on **Tauri v2 + Rust + React**, and optimized for **Google Kubernetes Engine (GKE)**.

Think of it as an **open, GKE-supercharged alternative to Lens**: browser-style multi-cluster tabs, interactive dashboards, a live YAML editor with diff, a high-performance Rust log engine, an embedded terminal (exec/attach into pods), an in-pod file browser/editor, and deep GKE networking / IAM inspectors — in a single lightweight native app (installer ≈ 4 MB).

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB) ![Rust](https://img.shields.io/badge/Rust-1.85%2B-orange) ![React](https://img.shields.io/badge/React-18-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)

> Community project — not affiliated with or endorsed by Google. "Kubernetes", "GKE" and "Lens" are trademarks of their respective owners.

---

## ✨ Features

### Clusters, contexts & auth
- **Native kubeconfig parsing** of `~/.kube/config` **and** the `KUBECONFIG` env var (merged), with automatic **GKE detection** (project / location / cluster).
- **Browser-style multi-cluster tabs** — operate several clusters at once, each with its own view state.
- **Favorites** sidebar — star clusters or specific resource views and reopen them in one click.
- **Advanced namespace selector** — *All / Single / Custom multi-select*.
- **GKE token auto-healing** — when a call fails because the `gke-gcloud-auth-plugin` token expired, a banner offers one-click `gcloud auth login` + re-check; stale clients are invalidated automatically so the UI self-heals (e.g. after the machine wakes up) without a restart.
- **Works with narrow permissions** — if listing namespaces is forbidden the cluster still opens: type the namespaces you can read and they are remembered per context. When a cluster-wide list is denied, the app falls back to one list per allowed namespace. Actions you are not allowed to run (checked with `SelfSubjectAccessReview`) are hidden or disabled, and a real 403 always shows a readable message.
- **Settings** — override the kubeconfig path (for configs stored elsewhere) and a live **tool check** (`kubectl` / `gcloud` / `gke-gcloud-auth-plugin`) with a warning banner if something's missing.

### Resources & editing
- One **generic, GVK-driven engine** serves **every** resource kind — built-ins *and* CRDs: list, view, delete, **scale**, **rolling-restart**.
- **Live lists** — lists are kept up to date by a Kubernetes **watch** (the server pushes changes); without the `watch` permission they fall back to polling. A dot in the toolbar shows which mode is active.
- **API discovery** — every kind the cluster serves (CRDs included) appears under *API Resources*, grouped by API group, with a filter.
- **Events tab** on every resource, live.
- **Monaco YAML editor with Live Diff** — compare your edits against the live cluster object before a server-side apply. The apply does not take over fields owned by other tools (Helm, Argo CD, controllers): on a conflict it shows who owns them and lets you *Force apply* explicitly.
- **ConfigMaps**: key/value table with quick copy. **Secrets**: masked by default with an interactive **Decode / Encode Base64** toggle per key.
- **Pod diagnosis** — a *Diagnosis* card on the pod overview explains what is wrong, with a hint for each finding: image pull errors, crash loops (with the meaning of the exit code), OOMKilled with the memory limit, failed init containers, failing probes, unschedulable or evicted pods, pods stuck in Terminating, and warning events. Warnings from before the pod became ready are shown as history.
- **Workloads**: Pods (with **live CPU/memory** columns and newest-first ordering), Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs.
- **Deployment revisions** — rollout history (from ReplicaSets) with images, replica counts and change-cause.
- **CronJob "Trigger now"** — create a Job from the CronJob's `jobTemplate` on demand.
- **Storage**: PVC, PV, StorageClass and GCE **VolumeSnapshots**.

### Terminal & pod access
- **Embedded terminal** — a real PTY (ConPTY on Windows via `portable-pty`) docked in a resizable footer panel, rendered with **xterm.js**, pre-loaded with `KUBECONFIG` + `use-context`.
- **Shell into a pod** (`kubectl exec -it`) and **Attach** (`kubectl attach -it`, for distroless images) directly from the pod's row/detail.
- **Debug container** — `kubectl debug` adds a temporary `busybox` container that shares the target container's processes: a shell even on images without one.
- **Native OS terminal** launcher as an alternative (`wt.exe`/PowerShell, `gnome-terminal`/`konsole`/`alacritty`, `iTerm2`/Terminal.app).
- **In-pod file browser & editor** — navigate the container filesystem, open a file in Monaco, edit and **save it straight back into the running container**.

### High-performance log engine (Rust)
- Stream a single **pod**, a whole **Deployment/StatefulSet/DaemonSet** (all replicas merged, **color-coded per pod**), or any **label selector**.
- **Multi-container** aware, with a container picker ("all" or one).
- **Previous logs** — view the output of a **crashed/restarted** instance (`--previous`).
- Filter toggles `.* Regex`, `Aa Case-sensitive`, `\b Whole-word` — **all processed in Rust** for low latency. **HTTP status coloring** (5xx red, 4xx yellow). One-click **export to `.txt`**.
- Smart auto-scroll: pins to the bottom, detaches when you scroll up, with a "jump to bottom" button.

### Dashboards & FinOps
- Interactive **Recharts** dashboard: pod-phase pie, per-node CPU/memory bars (via `metrics-server`), stat tiles.
- **Pod Right-Sizing (FinOps)** — Requests/Limits vs real usage, with `OOMKilled`-risk and over-provisioning/waste badges.
- **Security Linter** — flags `privileged`, run-as-root, dangerous capabilities, `hostNetwork`/`hostPID`, and missing resource limits.

### Advanced GKE networking
- Classic **Ingress** + **Gateway API** (Gateways / HTTPRoutes) with an interactive **React Flow** traffic topology.
- **GCE Ingress & BackendConfig inspector** — health-check deep-dive (path, port, timeouts, thresholds) and status badges for **Cloud Armor**, **Cloud CDN** and **IAP**.
- HTTPRoutes/Ingress show their hostnames at a glance.

### IAM & Workload Identity
- ServiceAccounts, Roles, ClusterRoles, (Cluster)RoleBindings.
- **Workload Identity Inspector** — badges each ServiceAccount's `iam.gke.io/gcp-service-account` binding.

### Nodes & safety tools
- **Node Cordon / Uncordon** and **Drain** — the drain shows a modal listing exactly which pods will be evicted (excluding DaemonSet & static pods) before you confirm; eviction respects PodDisruptionBudgets.
- **Port-Forward Manager** — start/stop `kubectl port-forward`-style tunnels and open them in the browser.
- **Safe Mode (Prod Lock)** — per-cluster read-only toggle that disables delete/scale/apply/drain/trigger — **enforced in the Rust backend**, not just the UI.

The terminal, logs and port-forward live in **docked, resizable, mutually-exclusive** bottom panels (VS Code style) — they push the content up instead of covering it.

---

## 📦 Install (users)

Download the package for your system from the [Releases](https://github.com/claudiograssia/k8s-nexus/releases), or build it yourself (see below).

| System | Package | Install |
|---|---|---|
| Windows | `KubeNexus GKE_x.y.z_x64-setup.exe` (recommended) or `.msi` | run the installer |
| Debian / Ubuntu | `KubeNexus GKE_x.y.z_amd64.deb` | `sudo apt install "./KubeNexus GKE_x.y.z_amd64.deb"` |
| Fedora / RHEL / openSUSE | `KubeNexus GKE-x.y.z-1.x86_64.rpm` | `sudo dnf install "./KubeNexus GKE-x.y.z-1.x86_64.rpm"` |
| Any Linux | `KubeNexus GKE_x.y.z_amd64.AppImage` | `chmod +x` it and run it |
| macOS (Apple Silicon and Intel) | `KubeNexus GKE_x.y.z_universal.dmg` | drag the app to *Applications* |

**Runtime prerequisites** (the app is a native frontend to these tools, it does not bundle them):
- **`kubectl`** on `PATH`.
- For GKE: **Google Cloud SDK** (`gcloud`) + the auth plugin: `gcloud components install gke-gcloud-auth-plugin`, and an authenticated `~/.kube/config`.
- **Windows**: WebView2 Runtime (preinstalled on Windows 10/11; the NSIS installer installs it if missing).
- **Linux**: WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`), pulled in automatically by the `.deb`/`.rpm`; the AppImage bundles it.

**Unsigned builds.** The packages are not code-signed:
- Windows SmartScreen shows an "unknown publisher" warning on first run → *More info → Run anyway*.
- macOS Gatekeeper refuses the first launch: right-click the app → *Open*, or run `xattr -cr "/Applications/KubeNexus GKE.app"` once.

On macOS an app started from Finder does not inherit the shell's `PATH`; KubeNexus reads it from your login shell at startup and also looks in the Homebrew and Cloud SDK folders, so `kubectl` and `gcloud` installed there are found.

---

## 🛠️ Development

### Prerequisites
- **Node.js ≥ 18** and **pnpm** (`npm i -g pnpm`)
- **Rust ≥ 1.85** (recent stable; `rustup update stable`) — <https://rustup.rs>
- **Tauri v2 system prerequisites** — <https://tauri.app/start/prerequisites/>
  - **Windows**: Microsoft C++ Build Tools + WebView2 (preinstalled on Win 10/11)
  - **Linux**: `webkit2gtk-4.1`, `libgtk-3-dev`, …
  - **macOS**: Xcode Command Line Tools
- `kubectl` and (for GKE) the Google Cloud SDK with `gke-gcloud-auth-plugin`

### Run & build
```sh
pnpm install
pnpm tauri dev      # dev mode (hot-reload frontend + Rust)
pnpm tauri build    # distributable bundle (.msi/.exe · .deb/.AppImage · .dmg)
```

On Linux, the system libraries for the build:
```sh
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf
# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel
```

`pnpm tauri build` produces the packages for the system it runs on (`.deb`, `.rpm` and `.AppImage` on Linux). macOS packages can only be built on a Mac: `pnpm tauri build --target universal-apple-darwin` (needs `rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

### Tests
```sh
pnpm typecheck                     # tsc --noEmit (strict mode)
pnpm test                          # Vitest: diagnosis, catalog, namespace fallback, permissions
cd src-tauri && cargo test         # Rust: error mapping, quantities, log filter, kubectl commands
cd src-tauri && cargo clippy --all-targets -- -D warnings
```
The tests never contact a cluster.

### CI and releases
- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request: typecheck, Vitest and build of the frontend, then `cargo fmt`, `clippy` and `cargo test` on Linux, Windows and macOS.
- **Release** (`.github/workflows/release.yml`): bump `version` in `src-tauri/tauri.conf.json` (so installers upgrade in place), then push a tag:
  ```sh
  git tag v0.2.0 && git push origin v0.2.0
  ```
  It builds the Windows, Linux and macOS (universal) packages and attaches them to a **draft** GitHub release to review and publish. Started by hand (*Run workflow*), it keeps the packages as workflow artifacts instead.

---

## 🏗️ Architecture

```
src-tauri/                 Rust backend (Tauri v2)
  src/
    kube/
      config.rs            kubeconfig + KUBECONFIG parsing, GKE detection
      client.rs            per-context kube-rs client pool (drives gke-gcloud-auth-plugin)
      resources.rs         generic GVK-driven list/get/apply/delete/scale/restart (dynamic API)
      watch.rs             live lists: kube-rs watcher → batched `watch://batch` events
      access.rs            permission checks (SelfSubjectAccessReview)
      discovery.rs         API discovery of every listable kind, CRDs included
      metrics.rs           metrics-server (node/pod usage) + quantity parsing
      logs.rs              multi-pod log streaming + Rust regex/case/whole-word filter engine
      portforward.rs       local TCP listener → pod port forwarding
      ops.rs               node cordon/drain (eviction) + CronJob trigger
    pty.rs                 embedded terminal PTYs (shell / kubectl exec / attach / debug)
    shell_env.rs           macOS: PATH from the login shell for apps started from Finder
    pod_fs.rs              in-pod filesystem browse/read/write via kubectl exec
    terminal.rs            native OS terminal launcher
    gcp.rs                 gcloud auth (GKE token auto-healing)
    state.rs               shared state + Safe Mode enforcement
    commands.rs            Tauri IPC command surface
src/                       React + TypeScript frontend
  lib/        api.ts (typed IPC) · types.ts · catalog.ts (resource registry) · listing.ts (namespace
              fallback) · permissions.ts · diagnose.ts (pod diagnosis) · utils · monaco
  store/      Zustand store (tabs, favorites, namespaces, panels, safe mode, tools, GKE auth)
  components/ layout · resources (+ detail panels) · yaml · dashboard · networking · iam ·
              logs · terminal · portforward · ui
```

The backend is **GVK-driven**: the frontend `catalog.ts` (plus API discovery for everything else) declares each kind's Group/Version/Kind + plural + scope, and a single Rust code path (via `kube`'s dynamic API) serves them all — built-ins and GKE CRDs alike. TLS uses **rustls (ring)**; the app installs the crypto provider at startup so GKE handshakes work reliably on Windows.

### Tech stack
Tauri v2 · Rust (`kube-rs`, `k8s-openapi`, `tokio`, `portable-pty`, `rustls`) · React 18 + TypeScript (strict) · Zustand · Tailwind + Radix UI · Monaco Editor · Recharts · React Flow · xterm.js.

---

## 📝 Notes & limitations
- **Safe Mode** is enforced server-side: write commands return a `safeMode` error for locked contexts.
- Metrics views require **metrics-server** in the cluster (present by default on GKE).
- **exec / file browser** need a shell + coreutils in the image → not available on **distroless** (use *Attach* there). Writing files also needs a writable, non-read-only filesystem.
- Monaco and xterm run **fully offline** (bundled workers) to satisfy Tauri's CSP.

## License
No license file yet — add one of your choice (e.g. MIT) before publishing if you want to allow reuse.
