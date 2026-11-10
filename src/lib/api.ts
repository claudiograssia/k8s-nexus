// Typed wrappers over the Tauri command surface. Every backend command is
// exposed here so components never touch `invoke` directly.

import { invoke } from "@tauri-apps/api/core";
import type {
  AccessCheck,
  DrainPod,
  FileEntry,
  GvkSpec,
  KubeconfigSummary,
  KubeObject,
  LogRequest,
  ToolStatus,
  NodeUsage,
  PodUsage,
  PortForwardInfo,
  PortForwardRequest,
  WatchRequest,
} from "./types";

export const api = {
  // Contexts ---------------------------------------------------------------
  listContexts: () => invoke<KubeconfigSummary>("list_contexts"),
  checkTools: () => invoke<ToolStatus>("check_tools"),
  setKubeconfigPath: (path: string | null) =>
    invoke<KubeconfigSummary>("set_kubeconfig_path", { path }),
  invalidateClient: (context: string) =>
    invoke<void>("invalidate_client", { context }),

  // Resources --------------------------------------------------------------
  listResources: (
    context: string,
    spec: GvkSpec,
    namespace?: string | null,
    labelSelector?: string | null,
  ) =>
    invoke<KubeObject[]>("list_resources", {
      context,
      spec,
      namespace: namespace ?? null,
      labelSelector: labelSelector ?? null,
    }),

  /** One answer per check, in order; null = could not be determined. */
  checkAccess: (context: string, checks: AccessCheck[]) =>
    invoke<(boolean | null)[]>("check_access", { context, checks }),

  // Live lists (changes arrive as `watch://batch` events) --------------------
  startWatch: (watchId: string, request: WatchRequest) =>
    invoke<void>("start_watch", { watchId, request }),
  stopWatch: (watchId: string) => invoke<void>("stop_watch", { watchId }),

  getResourceYaml: (
    context: string,
    spec: GvkSpec,
    namespace: string | null,
    name: string,
  ) =>
    invoke<string>("get_resource_yaml", { context, spec, namespace, name }),

  getResourceJson: (
    context: string,
    spec: GvkSpec,
    namespace: string | null,
    name: string,
  ) =>
    invoke<KubeObject>("get_resource_json", { context, spec, namespace, name }),

  /** Server-side apply. `force` takes over fields owned by other managers. */
  applyResourceYaml: (context: string, spec: GvkSpec, yaml: string, force = false) =>
    invoke<KubeObject>("apply_resource_yaml", { context, spec, yaml, force }),

  deleteResource: (
    context: string,
    spec: GvkSpec,
    namespace: string | null,
    name: string,
  ) => invoke<void>("delete_resource", { context, spec, namespace, name }),

  scaleResource: (
    context: string,
    spec: GvkSpec,
    namespace: string | null,
    name: string,
    replicas: number,
  ) =>
    invoke<KubeObject>("scale_resource", {
      context,
      spec,
      namespace,
      name,
      replicas,
    }),

  restartResource: (
    context: string,
    spec: GvkSpec,
    namespace: string | null,
    name: string,
  ) => invoke<KubeObject>("restart_resource", { context, spec, namespace, name }),

  // Metrics ----------------------------------------------------------------
  nodeUsage: (context: string) =>
    invoke<NodeUsage[]>("node_usage", { context }),
  podUsage: (context: string, namespace?: string | null) =>
    invoke<PodUsage[]>("pod_usage", { context, namespace: namespace ?? null }),

  // Logs -------------------------------------------------------------------
  startLogs: (sessionId: string, request: LogRequest) =>
    invoke<string[]>("start_logs", { sessionId, request }),
  stopLogs: (sessionId: string) => invoke<void>("stop_logs", { sessionId }),

  // Port-forward -----------------------------------------------------------
  startPortForward: (request: PortForwardRequest) =>
    invoke<PortForwardInfo>("start_port_forward", { request }),
  stopPortForward: (id: string) => invoke<void>("stop_port_forward", { id }),
  listPortForwards: () => invoke<PortForwardInfo[]>("list_port_forwards"),

  // Embedded terminal (PTY) ------------------------------------------------
  ptyOpen: (
    id: string,
    context: string,
    kubeconfig: string | null,
    rows: number,
    cols: number,
  ) => invoke<void>("pty_open", { id, context, kubeconfig, rows, cols }),
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, rows: number, cols: number) =>
    invoke<void>("pty_resize", { id, rows, cols }),
  ptyClose: (id: string) => invoke<void>("pty_close", { id }),
  ptyOpenExec: (
    id: string,
    context: string,
    namespace: string,
    pod: string,
    container: string | null,
    mode: "exec" | "attach",
    shell: string | null,
    rows: number,
    cols: number,
  ) =>
    invoke<void>("pty_open_exec", {
      id,
      context,
      namespace,
      pod,
      container,
      mode,
      shell,
      kubeconfig: null,
      rows,
      cols,
    }),

  // Node ops / CronJob trigger --------------------------------------------
  cordonNode: (context: string, node: string, on: boolean) =>
    invoke<void>("cordon_node", { context, node, on }),
  drainPreview: (context: string, node: string) =>
    invoke<DrainPod[]>("drain_preview", { context, node }),
  drainNode: (context: string, node: string) =>
    invoke<number>("drain_node", { context, node }),
  triggerCronjob: (context: string, namespace: string, name: string) =>
    invoke<string>("trigger_cronjob", { context, namespace, name }),

  // In-pod filesystem ------------------------------------------------------
  podListDir: (
    context: string,
    namespace: string,
    pod: string,
    container: string | null,
    path: string,
  ) => invoke<FileEntry[]>("pod_list_dir", { context, namespace, pod, container, path }),
  podReadFile: (
    context: string,
    namespace: string,
    pod: string,
    container: string | null,
    path: string,
  ) => invoke<string>("pod_read_file", { context, namespace, pod, container, path }),
  podWriteFile: (
    context: string,
    namespace: string,
    pod: string,
    container: string | null,
    path: string,
    content: string,
  ) => invoke<void>("pod_write_file", { context, namespace, pod, container, path, content }),

  // Terminal / GCP ---------------------------------------------------------
  openTerminal: (context: string, kubeconfig?: string | null) =>
    invoke<void>("open_terminal", { context, kubeconfig: kubeconfig ?? null }),
  gcloudLogin: () => invoke<void>("gcloud_login"),
  gcloudCheck: () => invoke<string>("gcloud_check"),

  // Safe Mode --------------------------------------------------------------
  setSafeMode: (context: string, enabled: boolean) =>
    invoke<void>("set_safe_mode", { context, enabled }),
  getSafeContexts: () => invoke<string[]>("get_safe_contexts"),

  // Misc -------------------------------------------------------------------
  writeTextFile: (path: string, contents: string) =>
    invoke<void>("write_text_file", { path, contents }),
};

export type Api = typeof api;
