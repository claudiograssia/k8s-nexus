// The catalog of Kubernetes resource kinds the IDE can browse. Each entry knows
// its GVK + plural + scope (so the generic backend can serve it) and the
// columns to render in the resource table.

import type { GvkSpec, KubeObject } from "./types";
import { formatAge, formatBytes, formatCpu, getString } from "./utils";

export type BadgeTone = "ok" | "warn" | "err" | "info" | "muted";

export interface ColumnDef {
  key: string;
  header: string;
  accessor: (o: KubeObject) => string;
  /** When set, the cell renders as a colored status badge. */
  tone?: (o: KubeObject) => BadgeTone;
  width?: string;
}

export type Category =
  | "Cluster"
  | "Workloads"
  | "Config"
  | "Storage"
  | "Network"
  | "Access Control"
  | "GKE";

export interface ResourceType {
  id: string;
  label: string;
  category: Category;
  gvk: GvkSpec;
  columns: ColumnDef[];
  /** Optional default row ordering (e.g. Events newest-first). */
  defaultSort?: (a: KubeObject, b: KubeObject) => number;
  /** Merge live metrics-server pod usage into rows (CPU/memory columns). */
  podMetrics?: boolean;
  scalable?: boolean;
  restartable?: boolean;
  /** Custom detail panel key handled by the resource detail view. */
  detail?: "pod" | "node" | "configmap" | "secret" | "serviceaccount" | "ingress" | "backendconfig";
}

const age: ColumnDef = {
  key: "age",
  header: "Age",
  accessor: (o) => formatAge(o.metadata?.creationTimestamp),
  width: "80px",
};

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

export function tsOf(s?: string): number {
  return s ? Date.parse(s) || 0 : 0;
}

/** Best "last seen" timestamp for a core/v1 or events.k8s.io Event. */
export function eventTime(o: KubeObject): string | undefined {
  const series = o["series"] as { lastObservedTime?: string } | undefined;
  const candidates = [
    o["lastTimestamp"],
    series?.lastObservedTime,
    o["eventTime"],
    o["firstTimestamp"],
    o.metadata?.creationTimestamp,
  ];
  const hit = candidates.find((c) => typeof c === "string");
  return typeof hit === "string" ? hit : undefined;
}

/** Join a `string[]` field into a comma-separated cell, or "—". */
function strList(v: unknown): string {
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === "string");
    return items.length ? items.join(", ") : "—";
  }
  return "—";
}

function podPhaseTone(o: KubeObject): BadgeTone {
  const phase = getString(o, "status.phase", "");
  const reason = deepContainerReason(o);
  if (reason && /CrashLoopBackOff|Error|OOMKilled|ImagePull|CreateContainerError/i.test(reason))
    return "err";
  switch (phase) {
    case "Running":
    case "Succeeded":
      return "ok";
    case "Pending":
      return "warn";
    case "Failed":
      return "err";
    default:
      return "muted";
  }
}

function deepContainerReason(o: KubeObject): string {
  const statuses = (o.status?.containerStatuses as Array<Record<string, unknown>>) ?? [];
  for (const cs of statuses) {
    const state = cs.state as Record<string, Record<string, unknown>> | undefined;
    const waiting = state?.waiting?.reason;
    const terminated = state?.terminated?.reason;
    if (typeof waiting === "string") return waiting;
    if (typeof terminated === "string") return terminated;
  }
  return "";
}

function podReady(o: KubeObject): string {
  const statuses = (o.status?.containerStatuses as Array<{ ready?: boolean }>) ?? [];
  const ready = statuses.filter((s) => s.ready).length;
  return `${ready}/${statuses.length || 0}`;
}

function podRestarts(o: KubeObject): string {
  const statuses = (o.status?.containerStatuses as Array<{ restartCount?: number }>) ?? [];
  return String(statuses.reduce((a, s) => a + (s.restartCount ?? 0), 0));
}

function nodeReadyTone(o: KubeObject): BadgeTone {
  const conds = (o.status?.conditions as Array<{ type?: string; status?: string }>) ?? [];
  const ready = conds.find((c) => c.type === "Ready");
  return ready?.status === "True" ? "ok" : "err";
}

function deployReadyTone(o: KubeObject): BadgeTone {
  const desired = num((o.spec as Record<string, unknown>)?.replicas, 0);
  const ready = num((o.status as Record<string, unknown>)?.readyReplicas, 0);
  if (desired === 0) return "muted";
  return ready >= desired ? "ok" : ready === 0 ? "err" : "warn";
}

export const CATALOG: ResourceType[] = [
  // Cluster ----------------------------------------------------------------
  {
    id: "namespaces",
    label: "Namespaces",
    category: "Cluster",
    gvk: { group: "", version: "v1", kind: "Namespace", plural: "namespaces", namespaced: false },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      {
        key: "status",
        header: "Status",
        accessor: (o) => getString(o, "status.phase"),
        tone: (o) => (getString(o, "status.phase") === "Active" ? "ok" : "warn"),
      },
      age,
    ],
  },
  {
    id: "nodes",
    label: "Nodes",
    category: "Cluster",
    detail: "node",
    gvk: { group: "", version: "v1", kind: "Node", plural: "nodes", namespaced: false },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ready", header: "Ready", accessor: () => "Ready", tone: nodeReadyTone, width: "90px" },
      {
        key: "roles",
        header: "Roles",
        accessor: (o) =>
          Object.keys(o.metadata?.labels ?? {})
            .filter((l) => l.startsWith("node-role.kubernetes.io/"))
            .map((l) => l.split("/")[1])
            .join(",") || "worker",
      },
      {
        key: "version",
        header: "Version",
        accessor: (o) => getString(o, "status.nodeInfo.kubeletVersion"),
      },
      age,
    ],
  },
  {
    id: "events",
    label: "Events",
    category: "Cluster",
    gvk: { group: "", version: "v1", kind: "Event", plural: "events", namespaced: true },
    // Newest-first (most recent "last seen" at the top).
    defaultSort: (a, b) => tsOf(eventTime(b)) - tsOf(eventTime(a)),
    columns: [
      {
        key: "type",
        header: "Type",
        accessor: (o) => getString(o, "type"),
        tone: (o) => (getString(o, "type") === "Warning" ? "warn" : "info"),
        width: "90px",
      },
      { key: "reason", header: "Reason", accessor: (o) => getString(o, "reason"), width: "160px" },
      {
        key: "object",
        header: "Object",
        accessor: (o) =>
          `${getString(o, "involvedObject.kind")}/${getString(o, "involvedObject.name")}`,
      },
      { key: "message", header: "Message", accessor: (o) => getString(o, "message") },
      {
        key: "count",
        header: "Count",
        accessor: (o) => {
          const c = o["count"];
          return typeof c === "number" ? String(c) : "1";
        },
        width: "64px",
      },
      {
        key: "lastSeen",
        header: "Last Seen",
        accessor: (o) => formatAge(eventTime(o)),
        width: "100px",
      },
    ],
  },

  // Workloads --------------------------------------------------------------
  {
    id: "pods",
    label: "Pods",
    category: "Workloads",
    detail: "pod",
    podMetrics: true,
    // Newest first (smallest age at the top).
    defaultSort: (a, b) => tsOf(a.metadata?.creationTimestamp) === tsOf(b.metadata?.creationTimestamp)
      ? 0
      : tsOf(b.metadata?.creationTimestamp) - tsOf(a.metadata?.creationTimestamp),
    gvk: { group: "", version: "v1", kind: "Pod", plural: "pods", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "ready", header: "Ready", accessor: podReady, width: "70px" },
      {
        key: "status",
        header: "Status",
        accessor: (o) => deepContainerReason(o) || getString(o, "status.phase"),
        tone: podPhaseTone,
        width: "140px",
      },
      { key: "restarts", header: "Restarts", accessor: podRestarts, width: "80px" },
      {
        key: "cpu",
        header: "CPU",
        accessor: (o) => (o.__cpuMilli != null ? formatCpu(o.__cpuMilli) : "—"),
        width: "80px",
      },
      {
        key: "mem",
        header: "Memory",
        accessor: (o) => (o.__memBytes != null ? formatBytes(o.__memBytes) : "—"),
        width: "90px",
      },
      { key: "node", header: "Node", accessor: (o) => getString(o, "spec.nodeName") },
      age,
    ],
  },
  {
    id: "deployments",
    label: "Deployments",
    category: "Workloads",
    scalable: true,
    restartable: true,
    gvk: { group: "apps", version: "v1", kind: "Deployment", plural: "deployments", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "ready",
        header: "Ready",
        accessor: (o) =>
          `${num((o.status as Record<string, unknown>)?.readyReplicas)}/${num((o.spec as Record<string, unknown>)?.replicas)}`,
        tone: deployReadyTone,
        width: "90px",
      },
      {
        key: "uptodate",
        header: "Up-to-date",
        accessor: (o) => String(num((o.status as Record<string, unknown>)?.updatedReplicas)),
        width: "100px",
      },
      {
        key: "available",
        header: "Available",
        accessor: (o) => String(num((o.status as Record<string, unknown>)?.availableReplicas)),
        width: "90px",
      },
      age,
    ],
  },
  {
    id: "statefulsets",
    label: "StatefulSets",
    category: "Workloads",
    scalable: true,
    restartable: true,
    gvk: { group: "apps", version: "v1", kind: "StatefulSet", plural: "statefulsets", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "ready",
        header: "Ready",
        accessor: (o) =>
          `${num((o.status as Record<string, unknown>)?.readyReplicas)}/${num((o.spec as Record<string, unknown>)?.replicas)}`,
        tone: deployReadyTone,
        width: "90px",
      },
      age,
    ],
  },
  {
    id: "daemonsets",
    label: "DaemonSets",
    category: "Workloads",
    restartable: true,
    gvk: { group: "apps", version: "v1", kind: "DaemonSet", plural: "daemonsets", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "ready",
        header: "Ready",
        accessor: (o) =>
          `${num((o.status as Record<string, unknown>)?.numberReady)}/${num((o.status as Record<string, unknown>)?.desiredNumberScheduled)}`,
        width: "90px",
      },
      age,
    ],
  },
  {
    id: "replicasets",
    label: "ReplicaSets",
    category: "Workloads",
    scalable: true,
    gvk: { group: "apps", version: "v1", kind: "ReplicaSet", plural: "replicasets", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "ready",
        header: "Ready",
        accessor: (o) =>
          `${num((o.status as Record<string, unknown>)?.readyReplicas)}/${num((o.spec as Record<string, unknown>)?.replicas)}`,
        width: "90px",
      },
      age,
    ],
  },
  {
    id: "jobs",
    label: "Jobs",
    category: "Workloads",
    gvk: { group: "batch", version: "v1", kind: "Job", plural: "jobs", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "completions",
        header: "Completions",
        accessor: (o) =>
          `${num((o.status as Record<string, unknown>)?.succeeded)}/${num((o.spec as Record<string, unknown>)?.completions, 1)}`,
        tone: (o) =>
          num((o.status as Record<string, unknown>)?.failed) > 0 ? "err" : "ok",
        width: "110px",
      },
      age,
    ],
  },
  {
    id: "cronjobs",
    label: "CronJobs",
    category: "Workloads",
    gvk: { group: "batch", version: "v1", kind: "CronJob", plural: "cronjobs", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "schedule", header: "Schedule", accessor: (o) => getString(o, "spec.schedule") },
      {
        key: "suspend",
        header: "Suspend",
        accessor: (o) => String(Boolean((o.spec as Record<string, unknown>)?.suspend)),
        tone: (o) => ((o.spec as Record<string, unknown>)?.suspend ? "warn" : "muted"),
        width: "90px",
      },
      age,
    ],
  },

  // Config -----------------------------------------------------------------
  {
    id: "configmaps",
    label: "ConfigMaps",
    category: "Config",
    detail: "configmap",
    gvk: { group: "", version: "v1", kind: "ConfigMap", plural: "configmaps", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "keys",
        header: "Keys",
        accessor: (o) => String(Object.keys(o.data ?? {}).length),
        width: "80px",
      },
      age,
    ],
  },
  {
    id: "secrets",
    label: "Secrets",
    category: "Config",
    detail: "secret",
    gvk: { group: "", version: "v1", kind: "Secret", plural: "secrets", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "type", header: "Type", accessor: (o) => getString(o, "type") },
      {
        key: "keys",
        header: "Keys",
        accessor: (o) => String(Object.keys(o.data ?? {}).length),
        width: "80px",
      },
      age,
    ],
  },
  {
    id: "hpas",
    label: "HorizontalPodAutoscalers",
    category: "Config",
    gvk: {
      group: "autoscaling",
      version: "v2",
      kind: "HorizontalPodAutoscaler",
      plural: "horizontalpodautoscalers",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "min",
        header: "Min",
        accessor: (o) => String(num((o.spec as Record<string, unknown>)?.minReplicas, 1)),
        width: "70px",
      },
      {
        key: "max",
        header: "Max",
        accessor: (o) => String(num((o.spec as Record<string, unknown>)?.maxReplicas)),
        width: "70px",
      },
      {
        key: "current",
        header: "Replicas",
        accessor: (o) => String(num((o.status as Record<string, unknown>)?.currentReplicas)),
        width: "90px",
      },
      age,
    ],
  },
  {
    id: "resourcequotas",
    label: "ResourceQuotas",
    category: "Config",
    gvk: { group: "", version: "v1", kind: "ResourceQuota", plural: "resourcequotas", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      age,
    ],
  },

  // Storage ----------------------------------------------------------------
  {
    id: "pvcs",
    label: "PersistentVolumeClaims",
    category: "Storage",
    gvk: {
      group: "",
      version: "v1",
      kind: "PersistentVolumeClaim",
      plural: "persistentvolumeclaims",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "status",
        header: "Status",
        accessor: (o) => getString(o, "status.phase"),
        tone: (o) => (getString(o, "status.phase") === "Bound" ? "ok" : "warn"),
        width: "100px",
      },
      {
        key: "capacity",
        header: "Capacity",
        accessor: (o) => getString(o, "status.capacity.storage"),
        width: "100px",
      },
      { key: "sc", header: "StorageClass", accessor: (o) => getString(o, "spec.storageClassName") },
      age,
    ],
  },
  {
    id: "pvs",
    label: "PersistentVolumes",
    category: "Storage",
    gvk: {
      group: "",
      version: "v1",
      kind: "PersistentVolume",
      plural: "persistentvolumes",
      namespaced: false,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      {
        key: "capacity",
        header: "Capacity",
        accessor: (o) => getString(o, "spec.capacity.storage"),
        width: "100px",
      },
      {
        key: "status",
        header: "Status",
        accessor: (o) => getString(o, "status.phase"),
        tone: (o) => (getString(o, "status.phase") === "Bound" ? "ok" : "warn"),
        width: "100px",
      },
      { key: "sc", header: "StorageClass", accessor: (o) => getString(o, "spec.storageClassName") },
      age,
    ],
  },
  {
    id: "storageclasses",
    label: "StorageClasses",
    category: "Storage",
    gvk: {
      group: "storage.k8s.io",
      version: "v1",
      kind: "StorageClass",
      plural: "storageclasses",
      namespaced: false,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "provisioner", header: "Provisioner", accessor: (o) => getString(o, "provisioner") },
      {
        key: "reclaim",
        header: "Reclaim",
        accessor: (o) => getString(o, "reclaimPolicy", "Delete"),
        width: "100px",
      },
      age,
    ],
  },
  {
    id: "volumesnapshots",
    label: "VolumeSnapshots",
    category: "Storage",
    gvk: {
      group: "snapshot.storage.k8s.io",
      version: "v1",
      kind: "VolumeSnapshot",
      plural: "volumesnapshots",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "ready",
        header: "Ready",
        accessor: (o) => String(Boolean((o.status as Record<string, unknown>)?.readyToUse)),
        tone: (o) => ((o.status as Record<string, unknown>)?.readyToUse ? "ok" : "warn"),
        width: "90px",
      },
      { key: "source", header: "Source PVC", accessor: (o) => getString(o, "spec.source.persistentVolumeClaimName") },
      age,
    ],
  },

  // Network ----------------------------------------------------------------
  {
    id: "services",
    label: "Services",
    category: "Network",
    gvk: { group: "", version: "v1", kind: "Service", plural: "services", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "type", header: "Type", accessor: (o) => getString(o, "spec.type", "ClusterIP"), width: "120px" },
      { key: "clusterip", header: "Cluster IP", accessor: (o) => getString(o, "spec.clusterIP") },
      age,
    ],
  },
  {
    id: "endpoints",
    label: "Endpoints",
    category: "Network",
    gvk: { group: "", version: "v1", kind: "Endpoints", plural: "endpoints", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      age,
    ],
  },
  {
    id: "ingresses",
    label: "Ingresses",
    category: "Network",
    detail: "ingress",
    gvk: { group: "networking.k8s.io", version: "v1", kind: "Ingress", plural: "ingresses", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "class",
        header: "Class",
        accessor: (o) =>
          getString(o, "spec.ingressClassName", o.metadata?.annotations?.["kubernetes.io/ingress.class"] ?? "—"),
        width: "100px",
      },
      {
        key: "hosts",
        header: "Hosts",
        accessor: (o) => {
          const rules = ((o.spec as Record<string, unknown>)?.rules as Array<{ host?: string }>) ?? [];
          const hosts = rules.map((r) => r.host).filter(Boolean);
          return hosts.length ? hosts.join(", ") : "*";
        },
      },
      age,
    ],
  },
  {
    id: "gateways",
    label: "Gateways",
    category: "Network",
    gvk: {
      group: "gateway.networking.k8s.io",
      version: "v1",
      kind: "Gateway",
      plural: "gateways",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "class", header: "GatewayClass", accessor: (o) => getString(o, "spec.gatewayClassName") },
      age,
    ],
  },
  {
    id: "httproutes",
    label: "HTTPRoutes",
    category: "Network",
    gvk: {
      group: "gateway.networking.k8s.io",
      version: "v1",
      kind: "HTTPRoute",
      plural: "httproutes",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "hosts", header: "Hosts", accessor: (o) => strList((o.spec as Record<string, unknown>)?.hostnames) },
      {
        key: "parents",
        header: "Parent Gateways",
        accessor: (o) => {
          const refs = ((o.spec as Record<string, unknown>)?.parentRefs as Array<{ name?: string }>) ?? [];
          return refs.map((r) => r.name).filter(Boolean).join(", ") || "—";
        },
      },
      age,
    ],
  },
  {
    id: "networkpolicies",
    label: "NetworkPolicies",
    category: "Network",
    gvk: {
      group: "networking.k8s.io",
      version: "v1",
      kind: "NetworkPolicy",
      plural: "networkpolicies",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      age,
    ],
  },

  // Access Control ---------------------------------------------------------
  {
    id: "serviceaccounts",
    label: "ServiceAccounts",
    category: "Access Control",
    detail: "serviceaccount",
    gvk: { group: "", version: "v1", kind: "ServiceAccount", plural: "serviceaccounts", namespaced: true },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "gsa",
        header: "GCP Service Account",
        accessor: (o) =>
          o.metadata?.annotations?.["iam.gke.io/gcp-service-account"] ?? "—",
      },
      age,
    ],
  },
  {
    id: "roles",
    label: "Roles",
    category: "Access Control",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "Role",
      plural: "roles",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      age,
    ],
  },
  {
    id: "rolebindings",
    label: "RoleBindings",
    category: "Access Control",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "RoleBinding",
      plural: "rolebindings",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      { key: "role", header: "Role", accessor: (o) => getString(o, "roleRef.name") },
      age,
    ],
  },
  {
    id: "clusterroles",
    label: "ClusterRoles",
    category: "Access Control",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "ClusterRole",
      plural: "clusterroles",
      namespaced: false,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      age,
    ],
  },
  {
    id: "clusterrolebindings",
    label: "ClusterRoleBindings",
    category: "Access Control",
    gvk: {
      group: "rbac.authorization.k8s.io",
      version: "v1",
      kind: "ClusterRoleBinding",
      plural: "clusterrolebindings",
      namespaced: false,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "role", header: "Role", accessor: (o) => getString(o, "roleRef.name") },
      age,
    ],
  },

  // GKE CRDs ---------------------------------------------------------------
  {
    id: "backendconfigs",
    label: "BackendConfigs",
    category: "GKE",
    detail: "backendconfig",
    gvk: {
      group: "cloud.google.com",
      version: "v1",
      kind: "BackendConfig",
      plural: "backendconfigs",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "cdn",
        header: "CDN",
        accessor: (o) => String(Boolean(getNested(o, ["spec", "cdn", "enabled"]))),
        tone: (o) => (getNested(o, ["spec", "cdn", "enabled"]) ? "ok" : "muted"),
        width: "70px",
      },
      {
        key: "armor",
        header: "Cloud Armor",
        accessor: (o) => (getNested(o, ["spec", "securityPolicy", "name"]) ? "on" : "off"),
        tone: (o) => (getNested(o, ["spec", "securityPolicy", "name"]) ? "ok" : "muted"),
        width: "110px",
      },
      {
        key: "iap",
        header: "IAP",
        accessor: (o) => String(Boolean(getNested(o, ["spec", "iap", "enabled"]))),
        tone: (o) => (getNested(o, ["spec", "iap", "enabled"]) ? "ok" : "muted"),
        width: "70px",
      },
      age,
    ],
  },
  {
    id: "frontendconfigs",
    label: "FrontendConfigs",
    category: "GKE",
    gvk: {
      group: "networking.gke.io",
      version: "v1beta1",
      kind: "FrontendConfig",
      plural: "frontendconfigs",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      age,
    ],
  },
  {
    id: "managedcertificates",
    label: "ManagedCertificates",
    category: "GKE",
    gvk: {
      group: "networking.gke.io",
      version: "v1",
      kind: "ManagedCertificate",
      plural: "managedcertificates",
      namespaced: true,
    },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      { key: "ns", header: "Namespace", accessor: (o) => o.metadata?.namespace ?? "—", width: "150px" },
      {
        key: "status",
        header: "Status",
        accessor: (o) => getString(o, "status.certificateStatus"),
        tone: (o) => (getString(o, "status.certificateStatus") === "Active" ? "ok" : "warn"),
      },
      age,
    ],
  },
];

export function getNested(o: KubeObject, path: string[]): unknown {
  return path.reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as object)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, o);
}

export const CATALOG_BY_ID = new Map(CATALOG.map((r) => [r.id, r]));

/** Workload kinds whose logs can be aggregated across their pods (via the
 *  pod-template label selector). Used to show the "Logs" action/button. */
export const WORKLOAD_LOG_KINDS = new Set([
  "deployments",
  "statefulsets",
  "daemonsets",
  "replicasets",
  "jobs",
]);

/** True when a resource kind supports viewing (aggregated) pod logs. */
export function supportsLogs(rt: ResourceType): boolean {
  return rt.detail === "pod" || WORKLOAD_LOG_KINDS.has(rt.id);
}

export const CATEGORIES: Category[] = [
  "Cluster",
  "Workloads",
  "Config",
  "Storage",
  "Network",
  "Access Control",
  "GKE",
];

export function resourcesByCategory(cat: Category): ResourceType[] {
  return CATALOG.filter((r) => r.category === cat);
}

// Discovered kinds -----------------------------------------------------------
//
// Kinds found through API discovery that the catalog does not describe. Their
// id carries the whole GVK so a tab or favorite can be restored before
// discovery has run again.

const DISCOVERED_PREFIX = "api:";

export function discoveredId(d: Pick<GvkSpec, "group" | "version" | "kind" | "plural" | "namespaced">): string {
  return `${DISCOVERED_PREFIX}${[d.group, d.version, d.kind, d.plural, d.namespaced ? "1" : "0"].join("|")}`;
}

const CATALOG_KEYS = new Set(CATALOG.map((r) => `${r.gvk.group}/${r.gvk.plural}`));

/** True when the catalog already has a hand-written entry for this kind. */
export function inCatalog(d: { group: string; plural: string }): boolean {
  return CATALOG_KEYS.has(`${d.group}/${d.plural}`);
}

function readyColumn(): ColumnDef {
  const ready = (o: KubeObject) => {
    const conds = (o.status as { conditions?: Array<{ type?: string; status?: string }> } | undefined)?.conditions;
    return conds?.find((c) => c.type === "Ready" || c.type === "Available")?.status;
  };
  return {
    key: "status",
    header: "Status",
    accessor: (o) => {
      const r = ready(o);
      if (r === "True") return "Ready";
      if (r === "False") return "Not ready";
      const phase = (o.status as { phase?: unknown } | undefined)?.phase;
      return typeof phase === "string" ? phase : "—";
    },
    tone: (o) => {
      const r = ready(o);
      return r === "True" ? "ok" : r === "False" ? "warn" : "muted";
    },
    width: "110px",
  };
}

const typeCache = new Map<string, ResourceType>();

/** Resource type for a catalog id or a discovered-kind id. */
export function resourceTypeById(id: string): ResourceType | undefined {
  const known = CATALOG_BY_ID.get(id) ?? typeCache.get(id);
  if (known || !id.startsWith(DISCOVERED_PREFIX)) return known;
  const [group, version, kind, plural, ns] = id.slice(DISCOVERED_PREFIX.length).split("|");
  if (!version || !kind || !plural) return undefined;
  const namespaced = ns === "1";
  const rt: ResourceType = {
    id,
    label: kind,
    category: "GKE",
    gvk: { group, version, kind, plural, namespaced },
    columns: [
      { key: "name", header: "Name", accessor: (o) => o.metadata?.name ?? "—" },
      ...(namespaced
        ? [{ key: "ns", header: "Namespace", accessor: (o: KubeObject) => o.metadata?.namespace ?? "—", width: "150px" }]
        : []),
      readyColumn(),
      age,
    ],
  };
  typeCache.set(id, rt);
  return rt;
}
