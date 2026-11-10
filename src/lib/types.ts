// Types mirroring the Rust backend contract (src-tauri/src/**).

export type ErrorKind =
  | "gkeAuth"
  | "auth"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "config"
  | "safeMode"
  | "process"
  | "connection"
  | "internal";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e
  );
}

export interface ContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace: string | null;
  server: string | null;
  isCurrent: boolean;
  isGke: boolean;
  gkeProject: string | null;
  gkeLocation: string | null;
  gkeCluster: string | null;
}

export interface KubeconfigSummary {
  sources: string[];
  currentContext: string | null;
  contexts: ContextInfo[];
}

export interface ToolStatus {
  kubectl: boolean;
  gcloud: boolean;
  gkeAuthPlugin: boolean;
}

/** Identifies a kind of resource; must match Rust GvkSpec (camelCase). */
export interface GvkSpec {
  group: string;
  version: string;
  kind: string;
  plural: string;
  namespaced: boolean;
}

export interface NodeUsage {
  name: string;
  cpuMilli: number;
  memoryBytes: number;
}

export interface ContainerUsage {
  name: string;
  cpuMilli: number;
  memoryBytes: number;
}

export interface PodUsage {
  name: string;
  namespace: string;
  cpuMilli: number;
  memoryBytes: number;
  containers: ContainerUsage[];
}

export interface FilterSpec {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface LogRequest {
  context: string;
  namespace: string;
  pods: string[];
  labelSelector?: string | null;
  container?: string | null;
  follow: boolean;
  tailLines?: number | null;
  /** Show logs from the previous (crashed) container instance. */
  previous?: boolean;
  filter: FilterSpec;
}

export interface LogLine {
  sessionId: string;
  pod: string;
  seq: number;
  message: string;
}

/** What a log panel should stream (a single pod, or a workload's replicas). */
export interface LogTarget {
  context: string;
  namespace: string;
  title: string;
  pods?: string[];
  labelSelector?: string;
  container?: string;
  /** Containers available to pick from (from the pod / pod template). */
  containers?: string[];
}

export interface PortForwardRequest {
  context: string;
  namespace: string;
  pod: string;
  remotePort: number;
  localPort: number;
}

export interface DrainPod {
  namespace: string;
  name: string;
  controller: string;
}

export interface FileEntry {
  name: string;
  isDir: boolean;
}

/** An interactive kubectl exec/attach session for the embedded terminal. */
export interface ExecTarget {
  context: string;
  namespace: string;
  pod: string;
  container?: string;
  mode: "exec" | "attach";
  shell?: string;
  title: string;
}

export interface PortForwardInfo {
  id: string;
  context: string;
  namespace: string;
  pod: string;
  remotePort: number;
  localPort: number;
  localUrl: string;
}

/** A raw Kubernetes object manifest as returned by the backend. */
export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind: string; name: string }>;
    deletionTimestamp?: string;
    [k: string]: unknown;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, unknown>;
  /** Internal: live usage merged in by the UI (not part of the API object). */
  __cpuMilli?: number;
  __memBytes?: number;
  [k: string]: unknown;
}

/** `kubectl auth can-i` question; must match Rust AccessCheck. */
export interface AccessCheck {
  group: string;
  resource: string;
  subresource?: string | null;
  verb: string;
  /** null / "" = cluster-wide. */
  namespace?: string | null;
}

/** Live list request; must match Rust WatchRequest. */
export interface WatchRequest {
  context: string;
  spec: GvkSpec;
  /** One watcher per namespace; empty = cluster-wide. */
  namespaces: string[];
  labelSelector?: string | null;
}

/** One change from a watch; `scope` is the namespace ("" = cluster-wide). */
export type WatchDelta =
  | { type: "reset"; scope: string; items: KubeObject[] }
  | { type: "apply"; scope: string; object: KubeObject }
  | { type: "delete"; scope: string; object: KubeObject }
  | {
      type: "error";
      scope: string;
      kind: ErrorKind;
      message: string;
      phase: "list" | "watch";
      fatal: boolean;
    };

export interface WatchBatch {
  watchId: string;
  deltas: WatchDelta[];
}
