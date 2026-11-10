import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Boxes,
  Cpu,
  MemoryStick,
  Server,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CenteredSpinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { fetchScoped, isNeedsNamespace } from "@/lib/listing";
import { useResourceList } from "@/components/common/useResourceList";
import { ListError } from "@/components/common/ListError";
import type { ClusterTab } from "@/store/useAppStore";
import { isAppError, type KubeObject, type NodeUsage, type PodUsage } from "@/lib/types";
import { formatBytes, formatCpu } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Theme colors (match index.css HSL tokens).
// ---------------------------------------------------------------------------
const COLORS = {
  ok: "hsl(152 62% 46%)",
  warn: "hsl(38 92% 55%)",
  err: "hsl(0 72% 58%)",
  info: "hsl(210 90% 62%)",
  muted: "hsl(215 14% 60%)",
} as const;

const GRID = "hsl(222 16% 20%)";
const AXIS = "hsl(215 14% 60%)";
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "hsl(222 22% 11%)",
  border: "1px solid hsl(222 16% 20%)",
  borderRadius: 8,
  fontSize: 11,
  color: "hsl(210 20% 92%)",
};

// ---------------------------------------------------------------------------
// Local narrowing helpers (no `any`).
// ---------------------------------------------------------------------------
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Parse a Kubernetes CPU quantity into millicores. Accepts "500m", "2", "1.5", "250000000n", "250000u". */
function parseCpuMilli(v: unknown): number {
  if (typeof v !== "string" || v.trim() === "") return 0;
  const s = v.trim();
  if (s.endsWith("m")) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : 0;
  }
  if (s.endsWith("n")) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n / 1e6 : 0;
  }
  if (s.endsWith("u")) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n / 1e3 : 0;
  }
  const cores = parseFloat(s);
  return Number.isFinite(cores) ? cores * 1000 : 0;
}

/** Parse a Kubernetes memory quantity into bytes. Accepts binary (Ki/Mi/Gi…), decimal (K/M/G…) or plain bytes. */
function parseMemBytes(v: unknown): number {
  if (typeof v !== "string" || v.trim() === "") return 0;
  const m = v.trim().match(/^([0-9.]+)\s*([A-Za-z]*)$/);
  if (!m) return 0;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = m[2];
  const factors: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    k: 1e3,
  };
  const factor = factors[unit] ?? 1;
  return value * factor;
}

// ---------------------------------------------------------------------------
// Pod inspection helpers.
// ---------------------------------------------------------------------------
const FAILING_REASON = /CrashLoopBackOff|Error|OOMKilled|ImagePull|CreateContainerError/i;

function containerFailReason(o: KubeObject): string {
  const statuses = asArray(o.status?.["containerStatuses"]);
  for (const cs of statuses) {
    const rec = asRecord(cs);
    const state = asRecord(rec?.["state"]);
    const waiting = asRecord(state?.["waiting"]);
    const reason = waiting?.["reason"];
    if (typeof reason === "string" && FAILING_REASON.test(reason)) return reason;
  }
  return "";
}

type PhaseBucket = "Running" | "Pending" | "Failed" | "Succeeded" | "Other";

function podBucket(o: KubeObject): PhaseBucket {
  if (containerFailReason(o)) return "Failed";
  const phase = o.status?.["phase"];
  switch (phase) {
    case "Running":
      return "Running";
    case "Pending":
      return "Pending";
    case "Failed":
      return "Failed";
    case "Succeeded":
      return "Succeeded";
    default:
      return "Other";
  }
}

function podContainers(o: KubeObject): Record<string, unknown>[] {
  return asArray(o.spec?.["containers"])
    .map(asRecord)
    .filter((c): c is Record<string, unknown> => !!c);
}

function nodeIsReady(o: KubeObject): boolean {
  const conds = asArray(o.status?.["conditions"]);
  return conds.some((c) => {
    const rec = asRecord(c);
    return rec?.["type"] === "Ready" && rec?.["status"] === "True";
  });
}

// ---------------------------------------------------------------------------
// Data types for charts.
// ---------------------------------------------------------------------------
interface PhaseDatum {
  name: PhaseBucket;
  value: number;
  color: string;
}

interface NodeDatum {
  name: string;
  cpuUsed: number;
  cpuAlloc: number;
  memUsed: number;
  memAlloc: number;
}

interface OffendingPod {
  key: string;
  name: string;
  namespace: string;
}

interface LinterFinding {
  label: string;
  tone: "err" | "warn";
  pods: OffendingPod[];
}

// ---------------------------------------------------------------------------
// Per-source load failures (typical with narrow RBAC / IAM permissions).
// ---------------------------------------------------------------------------
type Source = "pods" | "nodes" | "nodeUsage" | "podUsage";
type SourceErrors = Partial<Record<Source, string>>;

const errorMessage = (e: unknown) => (isAppError(e) ? e.message : String(e));

const POD_GVK = { group: "", version: "v1", kind: "Pod", plural: "pods", namespaced: true };
const NODE_GVK = { group: "", version: "v1", kind: "Node", plural: "nodes", namespaced: false };

const SOURCE_LABELS: Record<Source, string> = {
  pods: "Pods",
  nodes: "Nodes",
  nodeUsage: "Node metrics",
  podUsage: "Pod metrics",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function DashboardView({ tab }: { tab: ClusterTab }) {
  const podList = useResourceList({ context: tab.context, spec: POD_GVK, selection: tab, pollMs: 10_000 });
  const nodeList = useResourceList({ context: tab.context, spec: NODE_GVK, selection: tab, pollMs: 10_000 });
  const pods = podList.items;
  const nodes = nodeList.items;
  const [nodeUsage, setNodeUsage] = React.useState<NodeUsage[]>([]);
  const [podUsage, setPodUsage] = React.useState<PodUsage[]>([]);
  const [metricErrors, setMetricErrors] = React.useState<SourceErrors>({});

  // metrics-server has no watch: polled.
  React.useEffect(() => {
    let alive = true;
    async function load() {
      const failed: SourceErrors = {};
      const fail = (source: Source, e: unknown) => {
        failed[source] = errorMessage(e);
        return null;
      };
      const [nodeUse, podUse] = await Promise.all([
        api.nodeUsage(tab.context).catch((e: unknown) => fail("nodeUsage", e)),
        fetchScoped(
          tab.context,
          tab,
          { id: "metrics.k8s.io/pods", namespaced: true },
          "pod metrics",
          (ns) => api.podUsage(tab.context, ns),
        ).catch((e: unknown) => fail("podUsage", e)),
      ]);
      if (!alive) return;
      setMetricErrors(failed);
      if (nodeUse) setNodeUsage(nodeUse);
      if (podUse) setPodUsage(podUse);
    }
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.context, tab.namespaceMode, tab.namespaces.join(",")]);

  const errors: SourceErrors = {
    ...(podList.error != null && !isNeedsNamespace(podList.error)
      ? { pods: errorMessage(podList.error) }
      : {}),
    ...(nodeList.error != null ? { nodes: errorMessage(nodeList.error) } : {}),
    ...metricErrors,
  };
  const loading = podList.loading && nodeList.loading;

  // -- Derived stats --------------------------------------------------------
  const derived = React.useMemo(() => {
    const buckets: Record<PhaseBucket, number> = {
      Running: 0,
      Pending: 0,
      Failed: 0,
      Succeeded: 0,
      Other: 0,
    };
    for (const p of pods) buckets[podBucket(p)]++;

    const allPhases: PhaseDatum[] = [
      { name: "Running", value: buckets.Running, color: COLORS.ok },
      { name: "Pending", value: buckets.Pending, color: COLORS.warn },
      { name: "Failed", value: buckets.Failed, color: COLORS.err },
      { name: "Succeeded", value: buckets.Succeeded, color: COLORS.info },
      { name: "Other", value: buckets.Other, color: COLORS.muted },
    ];
    const phaseData: PhaseDatum[] = allPhases.filter((d) => d.value > 0);

    const usageByNode = new Map(nodeUsage.map((u) => [u.name, u]));
    const nodeData: NodeDatum[] = nodes.map((n) => {
      const name = n.metadata?.name ?? "—";
      const alloc = asRecord(n.status?.["allocatable"]);
      const use = usageByNode.get(name);
      return {
        name,
        cpuUsed: use?.cpuMilli ?? 0,
        cpuAlloc: parseCpuMilli(alloc?.["cpu"]),
        memUsed: use?.memoryBytes ?? 0,
        memAlloc: parseMemBytes(alloc?.["memory"]),
      };
    });

    const nodesReady = nodes.filter(nodeIsReady).length;
    const totalCpuUsed = nodeUsage.reduce((a, u) => a + u.cpuMilli, 0);
    const totalMemUsed = nodeUsage.reduce((a, u) => a + u.memoryBytes, 0);

    return {
      buckets,
      phaseData,
      nodeData,
      nodesReady,
      totalCpuUsed,
      totalMemUsed,
    };
  }, [pods, nodes, nodeUsage]);

  // -- Security linter ------------------------------------------------------
  const findings = React.useMemo<LinterFinding[]>(() => {
    const privileged: OffendingPod[] = [];
    const runAsRoot: OffendingPod[] = [];
    const noLimits: OffendingPod[] = [];

    for (const p of pods) {
      const name = p.metadata?.name ?? "—";
      const namespace = p.metadata?.namespace ?? "—";
      const key = `${namespace}/${name}`;
      const entry: OffendingPod = { key, name, namespace };
      const containers = podContainers(p);

      if (
        containers.some((c) => asRecord(c["securityContext"])?.["privileged"] === true)
      ) {
        privileged.push(entry);
      }

      const podSec = asRecord(p.spec?.["securityContext"]);
      if (podSec?.["runAsNonRoot"] !== true) {
        runAsRoot.push(entry);
      }

      if (
        containers.some((c) => {
          const res = asRecord(c["resources"]);
          const limits = asRecord(res?.["limits"]);
          return !limits || Object.keys(limits).length === 0;
        })
      ) {
        noLimits.push(entry);
      }
    }

    return [
      { label: "Privileged containers", tone: "err", pods: privileged },
      { label: "runAsNonRoot not set", tone: "warn", pods: runAsRoot },
      { label: "Missing resource limits", tone: "warn", pods: noLimits },
    ];
  }, [pods]);

  if (loading) {
    return <CenteredSpinner label="Loading cluster health…" />;
  }

  const podUsageCount = podUsage.length;

  return (
    <div className="h-full overflow-auto p-3 text-[12px]">
      {isNeedsNamespace(podList.error) && (
        <div className="-mx-3 -mt-3 mb-3">
          <ListError context={tab.context} tabId={tab.id} error={podList.error} label="Pods" />
        </div>
      )}
      <SourceErrorsBanner errors={errors} />

      {/* Stat cards ------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard icon={<Boxes className="size-3.5" />} label="Pods" value={String(pods.length)} />
        <StatCard
          icon={<Activity className="size-3.5" style={{ color: COLORS.ok }} />}
          label="Running"
          value={String(derived.buckets.Running)}
          valueColor={COLORS.ok}
        />
        <StatCard
          icon={<Activity className="size-3.5" style={{ color: COLORS.warn }} />}
          label="Pending"
          value={String(derived.buckets.Pending)}
          valueColor={COLORS.warn}
        />
        <StatCard
          icon={<Activity className="size-3.5" style={{ color: COLORS.err }} />}
          label="Failing"
          value={String(derived.buckets.Failed)}
          valueColor={COLORS.err}
        />
        <StatCard
          icon={<Server className="size-3.5" style={{ color: COLORS.info }} />}
          label="Nodes Ready"
          value={`${derived.nodesReady}/${nodes.length}`}
        />
        <StatCard
          icon={<Cpu className="size-3.5" />}
          label="CPU Used"
          value={formatCpu(derived.totalCpuUsed)}
        />
        <StatCard
          icon={<MemoryStick className="size-3.5" />}
          label="Mem Used"
          value={formatBytes(derived.totalMemUsed)}
        />
      </div>

      {/* Charts ----------------------------------------------------------- */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Pod phases pie */}
        <ChartCard title="Pod Phases">
          {derived.phaseData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={derived.phaseData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={64}
                  paddingAngle={2}
                  stroke="hsl(222 22% 11%)"
                >
                  {derived.phaseData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: AXIS }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* CPU per node */}
        <ChartCard title="CPU per Node (millicores)">
          {derived.nodeData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={derived.nodeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} height={40} angle={-20} textAnchor="end" />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} width={44} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: "hsl(215 14% 60% / 0.08)" }}
                  formatter={(value) => `${formatCpu(Number(value))}`}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: AXIS }} />
                <Bar dataKey="cpuAlloc" name="Allocatable" fill={COLORS.muted} radius={[2, 2, 0, 0]} />
                <Bar dataKey="cpuUsed" name="Used" fill={COLORS.info} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Memory per node */}
        <ChartCard title="Memory per Node">
          {derived.nodeData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={derived.nodeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} height={40} angle={-20} textAnchor="end" />
                <YAxis
                  tick={{ fontSize: 10, fill: AXIS }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  width={52}
                  tickFormatter={(value) => formatBytes(Number(value))}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: "hsl(215 14% 60% / 0.08)" }}
                  formatter={(value) => `${formatBytes(Number(value))}`}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: AXIS }} />
                <Bar dataKey="memAlloc" name="Allocatable" fill={COLORS.muted} radius={[2, 2, 0, 0]} />
                <Bar dataKey="memUsed" name="Used" fill={COLORS.ok} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Security linter -------------------------------------------------- */}
      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert className="size-4" style={{ color: COLORS.warn }} />
          <h3 className="text-[13px] font-semibold">Security Linter</h3>
          <span className="text-[11px] text-muted-foreground">
            {pods.length} pods scanned · {podUsageCount} with metrics
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {findings.map((f) => (
            <div key={f.label} className="rounded-md border border-border bg-background/40 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{f.label}</span>
                <Badge tone={f.pods.length === 0 ? "ok" : f.tone}>{f.pods.length}</Badge>
              </div>
              {f.pods.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No issues found</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {f.pods.slice(0, 8).map((p) => (
                    <Badge key={p.key} tone={f.tone} className="max-w-full truncate">
                      <span className="truncate">
                        {p.namespace}/{p.name}
                      </span>
                    </Badge>
                  ))}
                  {f.pods.length > 8 && (
                    <Badge tone="muted">+{f.pods.length - 8} more</Badge>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers.
// ---------------------------------------------------------------------------
function StatCard({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-64 flex-col rounded-lg border border-border bg-card p-3">
      <h3 className="mb-2 text-[12px] font-semibold text-muted-foreground">{title}</h3>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
      No data available
    </div>
  );
}

/** One row per distinct message, listing the sources that failed with it. */
function SourceErrorsBanner({ errors }: { errors: SourceErrors }) {
  const groups = new Map<string, string[]>();
  for (const [source, message] of Object.entries(errors) as [Source, string][]) {
    groups.set(message, [...(groups.get(message) ?? []), SOURCE_LABELS[source]]);
  }
  if (groups.size === 0) return null;
  return (
    <div className="mb-3 space-y-1.5 rounded-lg border border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)] p-3">
      {[...groups].map(([message, sources]) => (
        <div key={message} className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color: COLORS.warn }} />
          <p className="min-w-0 select-text break-words text-[11px]">
            <span className="font-semibold">{sources.join(", ")} unavailable:</span>{" "}
            <span className="text-muted-foreground">{message}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
