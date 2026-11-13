// Pod diagnosis: turns status, container states and events into a short list
// of findings ("why is this pod not working?") with a hint for each.

import type { KubeObject } from "./types";

export type Severity = "err" | "warn" | "info";

export interface Finding {
  severity: Severity;
  title: string;
  /** Raw detail from the cluster (message, exit code, …). */
  detail?: string;
  /** What to check or do next. */
  hint?: string;
  container?: string;
}

interface StateDetail {
  reason?: string;
  message?: string;
  exitCode?: number;
  signal?: number;
  startedAt?: string;
  finishedAt?: string;
}

interface ContainerStatus {
  name: string;
  ready?: boolean;
  restartCount?: number;
  image?: string;
  started?: boolean;
  state?: { waiting?: StateDetail; running?: StateDetail; terminated?: StateDetail };
  lastState?: { terminated?: StateDetail };
}

interface Container {
  name: string;
  image?: string;
  resources?: { limits?: Record<string, string> };
  readinessProbe?: unknown;
  livenessProbe?: unknown;
  startupProbe?: unknown;
}

interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

/** Last time an event was seen (core/v1 or events.k8s.io fields). */
function lastSeen(e: KubeObject): number {
  const series = e["series"] as { lastObservedTime?: string } | undefined;
  const t = e["lastTimestamp"] ?? series?.lastObservedTime ?? e["eventTime"] ?? e["firstTimestamp"];
  return typeof t === "string" ? Date.parse(t) || 0 : 0;
}

const EXIT_CODES: Record<number, string> = {
  1: "generic application error",
  2: "misuse of shell builtin / bad arguments",
  126: "command found but not executable (permissions?)",
  127: "command not found (wrong entrypoint or image?)",
  128: "invalid exit argument",
  134: "aborted (SIGABRT)",
  137: "killed (SIGKILL): OOM or forced stop after the grace period",
  139: "segmentation fault (SIGSEGV)",
  143: "terminated (SIGTERM)",
};

function exitCodeText(t: StateDetail): string {
  const code = t.exitCode;
  if (code === undefined) return t.reason ?? "terminated";
  const meaning = EXIT_CODES[code];
  return `exit code ${code}${meaning ? ` — ${meaning}` : ""}${t.reason ? ` (${t.reason})` : ""}`;
}

const IMAGE_PULL = new Set(["ImagePullBackOff", "ErrImagePull", "InvalidImageName", "ErrImageNeverPull"]);

function waitingFinding(c: ContainerStatus, spec: Container | undefined, init: boolean): Finding | null {
  const w = c.state?.waiting;
  if (!w?.reason) return null;
  const who = init ? `Init container ${c.name}` : `Container ${c.name}`;
  const last = c.lastState?.terminated;
  switch (true) {
    case IMAGE_PULL.has(w.reason):
      return {
        severity: "err",
        container: c.name,
        title: `${who}: cannot pull image`,
        detail: w.message ?? c.image ?? spec?.image,
        hint: "Check the image name and tag, that it exists in the registry, and that the node's service account (or imagePullSecrets) can read it.",
      };
    case w.reason === "CrashLoopBackOff":
      return {
        severity: "err",
        container: c.name,
        title: `${who} keeps crashing (${c.restartCount ?? 0} restarts)`,
        detail: last ? `Last run: ${exitCodeText(last)}${last.message ? `\n${last.message}` : ""}` : w.message,
        hint:
          last?.reason === "OOMKilled"
            ? "It runs out of memory: raise the memory limit or reduce usage."
            : "Open the logs of the previous run to see why it exits.",
      };
    case w.reason === "CreateContainerConfigError" || w.reason === "CreateContainerError":
      return {
        severity: "err",
        container: c.name,
        title: `${who}: invalid configuration`,
        detail: w.message,
        hint: "Usually a missing ConfigMap/Secret or key referenced by env/envFrom/volumes.",
      };
    case w.reason === "RunContainerError" || w.reason === "StartError":
      return {
        severity: "err",
        container: c.name,
        title: `${who}: failed to start`,
        detail: w.message,
        hint: "Check command/args, the entrypoint in the image and mounted paths.",
      };
    case w.reason === "ContainerCreating" || w.reason === "PodInitializing":
      return null; // Covered by events (FailedMount, sandbox errors) or just in progress.
    default:
      return { severity: "warn", container: c.name, title: `${who} waiting: ${w.reason}`, detail: w.message };
  }
}

/** Analyse a pod and its events (core/v1 Events about it). */
export function diagnosePod(pod: KubeObject, events: KubeObject[] = []): Finding[] {
  const spec = (pod.spec ?? {}) as { containers?: Container[]; initContainers?: Container[] };
  const status = (pod.status ?? {}) as {
    phase?: string;
    reason?: string;
    message?: string;
    conditions?: Condition[];
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
  const containers = spec.containers ?? [];
  const specOf = (name: string) =>
    containers.find((c) => c.name === name) ?? spec.initContainers?.find((c) => c.name === name);
  const out: Finding[] = [];

  // Pod-level state.
  if (status.reason === "Evicted") {
    out.push({
      severity: "err",
      title: "Pod was evicted",
      detail: status.message,
      hint: "The node ran short of resources (often memory or ephemeral storage). Set requests that reflect real usage.",
    });
  }
  const deleting = pod.metadata?.deletionTimestamp;
  if (deleting && Date.now() - Date.parse(deleting) > 5 * 60_000) {
    const finalizers = (pod.metadata?.finalizers as string[] | undefined) ?? [];
    out.push({
      severity: "warn",
      title: "Stuck in Terminating",
      detail: finalizers.length ? `Finalizers: ${finalizers.join(", ")}` : undefined,
      hint: "A finalizer is pending, or the node is unreachable so the kubelet cannot confirm the shutdown.",
    });
  }
  const scheduled = status.conditions?.find((c) => c.type === "PodScheduled");
  if (scheduled?.status === "False") {
    out.push({
      severity: "err",
      title: `Not scheduled${scheduled.reason ? `: ${scheduled.reason}` : ""}`,
      detail: scheduled.message,
      hint: "No node fits: check requests, nodeSelector/affinity, taints and tolerations, and node pool autoscaling limits.",
    });
  }

  // Containers.
  for (const c of status.initContainerStatuses ?? []) {
    const f = waitingFinding(c, specOf(c.name), true);
    if (f) out.push(f);
    const t = c.state?.terminated;
    if (t && t.exitCode !== 0) {
      out.push({
        severity: "err",
        container: c.name,
        title: `Init container ${c.name} failed`,
        detail: exitCodeText(t),
        hint: "Main containers do not start until every init container succeeds. Check its logs.",
      });
    }
  }
  for (const c of status.containerStatuses ?? []) {
    const s = specOf(c.name);
    const waiting = waitingFinding(c, s, false);
    if (waiting) out.push(waiting);

    const last = c.lastState?.terminated;
    if (last?.reason === "OOMKilled" && waiting?.title.includes("crashing") !== true) {
      out.push({
        severity: "err",
        container: c.name,
        title: `Container ${c.name} was OOMKilled`,
        detail: `Memory limit: ${s?.resources?.limits?.memory ?? "none (node memory pressure)"}`,
        hint: "Raise the memory limit or reduce the application's memory usage.",
      });
    } else if (last && !waiting && (c.restartCount ?? 0) > 0) {
      out.push({
        severity: (c.restartCount ?? 0) >= 5 ? "warn" : "info",
        container: c.name,
        title: `Container ${c.name} restarted ${c.restartCount} times`,
        detail: `Last exit: ${exitCodeText(last)}${last.finishedAt ? ` at ${new Date(last.finishedAt).toLocaleString()}` : ""}`,
        hint: "Check the previous run's logs.",
      });
    }

    if (c.state?.running && c.ready === false) {
      out.push({
        severity: "warn",
        container: c.name,
        title: `Container ${c.name} is running but not ready`,
        hint: s?.readinessProbe
          ? "The readiness probe fails: the pod gets no Service traffic. See the probe events below."
          : c.started === false
            ? "The startup probe has not passed yet."
            : undefined,
      });
    }
  }

  // Warning events not already explained above. Those from before the pod
  // last became Ready are history (typical during startup), not a problem.
  const ready = status.conditions?.find((c) => c.type === "Ready");
  const readySince =
    ready?.status === "True" && ready.lastTransitionTime ? Date.parse(ready.lastTransitionTime) : null;
  const seen = new Set<string>();
  for (const e of events) {
    if (e["type"] !== "Warning") continue;
    const reason = String(e["reason"] ?? "");
    const message = String(e["message"] ?? "");
    if (reason === "BackOff" || reason === "Failed" || seen.has(reason)) continue;
    if (reason === "FailedScheduling" && scheduled?.status === "False") continue;
    seen.add(reason);
    const count = typeof e["count"] === "number" ? (e["count"] as number) : 1;
    const resolved = readySince !== null && lastSeen(e) <= readySince;
    out.push({
      severity: resolved ? "info" : reason === "Unhealthy" ? "warn" : "err",
      title: eventTitle(reason) + (count > 1 ? ` (×${count})` : "") + (resolved ? " — before the pod became ready" : ""),
      detail: message,
      hint: resolved ? undefined : EVENT_HINTS[reason],
    });
  }

  return out.sort((a, b) => rank(a.severity) - rank(b.severity));
}

const rank = (s: Severity) => (s === "err" ? 0 : s === "warn" ? 1 : 2);

const EVENT_TITLES: Record<string, string> = {
  Unhealthy: "Probe failing",
  FailedMount: "Volume mount failed",
  FailedAttachVolume: "Volume attach failed",
  FailedCreatePodSandBox: "Pod sandbox could not be created",
  FailedScheduling: "Scheduling failed",
  NetworkNotReady: "Node network not ready",
  Evicted: "Evicted",
  Preempted: "Preempted by a higher-priority pod",
};

const EVENT_HINTS: Record<string, string> = {
  Unhealthy: "Check the probe path, port and timeouts, and whether the app is slow to start (consider a startupProbe).",
  FailedMount: "The referenced ConfigMap, Secret or PVC may be missing, or the volume is attached to another node.",
  FailedAttachVolume: "A ReadWriteOnce disk may still be attached to another node; it can take a few minutes to detach.",
  FailedCreatePodSandBox: "Usually a CNI / IP exhaustion problem on the node.",
};

function eventTitle(reason: string): string {
  return EVENT_TITLES[reason] ?? reason.replace(/([a-z])([A-Z])/g, "$1 $2");
}
