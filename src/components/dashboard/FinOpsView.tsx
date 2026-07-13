import * as React from "react";
import { api } from "@/lib/api";
import type { KubeObject, PodUsage } from "@/lib/types";
import { formatBytes, formatCpu } from "@/lib/utils";
import { namespaceScope } from "@/lib/scope";
import { useAppStore, type ClusterTab } from "@/store/useAppStore";
import { Badge } from "@/components/ui/badge";
import { CenteredSpinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";

const POD_GVK = {
  group: "",
  version: "v1",
  kind: "Pod",
  plural: "pods",
  namespaced: true,
} as const;

const REFRESH_MS = 15_000;

/** Parse a Kubernetes CPU quantity into millicores. */
function parseCpuMilli(v: unknown): number {
  if (typeof v === "number") return v * 1000;
  if (typeof v !== "string" || v.length === 0) return 0;
  const s = v.trim();
  if (s.endsWith("m")) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : 0;
  }
  if (s.endsWith("n")) {
    // nanocores
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n / 1_000_000 : 0;
  }
  if (s.endsWith("u")) {
    // microcores
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n / 1000 : 0;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * 1000 : 0;
}

/** Parse a Kubernetes memory quantity into bytes. */
function parseMemBytes(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || v.length === 0) return 0;
  const s = v.trim();
  const binary: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  const decimal: Record<string, number> = {
    k: 1000,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  for (const suffix of Object.keys(binary)) {
    if (s.endsWith(suffix)) {
      const n = parseFloat(s.slice(0, -suffix.length));
      return Number.isFinite(n) ? n * binary[suffix] : 0;
    }
  }
  for (const suffix of Object.keys(decimal)) {
    if (s.endsWith(suffix)) {
      const n = parseFloat(s.slice(0, -suffix.length));
      return Number.isFinite(n) ? n * decimal[suffix] : 0;
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

interface ResourceQuantities {
  cpu?: unknown;
  memory?: unknown;
}

interface ContainerSpec {
  name?: string;
  resources?: {
    requests?: ResourceQuantities;
    limits?: ResourceQuantities;
  };
}

interface ContainerStatus {
  name?: string;
  restartCount?: number;
  state?: {
    waiting?: { reason?: string };
  };
  lastState?: {
    terminated?: { reason?: string };
  };
}

interface Row {
  key: string;
  namespace: string;
  pod: string;
  container: string;
  cpuReqMilli: number;
  cpuUsedMilli: number;
  cpuLimitMilli: number;
  memReqBytes: number;
  memUsedBytes: number;
  memLimitBytes: number;
  restarts: number;
  oomRisk: boolean;
  crashLoop: boolean;
  overProvisioned: boolean;
  noLimits: boolean;
  wastedCpuMilli: number;
  wastedMemBytes: number;
}

function toContainerSpecs(pod: KubeObject): ContainerSpec[] {
  const containers = (pod.spec as Record<string, unknown> | undefined)?.containers;
  return Array.isArray(containers) ? (containers as ContainerSpec[]) : [];
}

function toContainerStatuses(pod: KubeObject): ContainerStatus[] {
  const statuses = (pod.status as Record<string, unknown> | undefined)
    ?.containerStatuses;
  return Array.isArray(statuses) ? (statuses as ContainerStatus[]) : [];
}

function buildRows(pods: KubeObject[], usage: PodUsage[]): Row[] {
  const usageByPod = new Map<string, PodUsage>();
  for (const u of usage) {
    usageByPod.set(`${u.namespace}/${u.name}`, u);
  }

  const rows: Row[] = [];
  for (const pod of pods) {
    const podName = pod.metadata?.name ?? "—";
    const namespace = pod.metadata?.namespace ?? "—";
    const podUsage = usageByPod.get(`${namespace}/${podName}`);
    const statuses = toContainerStatuses(pod);

    for (const c of toContainerSpecs(pod)) {
      const cName = c.name ?? "—";
      const req = c.resources?.requests;
      const lim = c.resources?.limits;

      const cpuReqMilli = req?.cpu !== undefined ? parseCpuMilli(req.cpu) : 0;
      const cpuLimitMilli = lim?.cpu !== undefined ? parseCpuMilli(lim.cpu) : 0;
      const memReqBytes = req?.memory !== undefined ? parseMemBytes(req.memory) : 0;
      const memLimitBytes =
        lim?.memory !== undefined ? parseMemBytes(lim.memory) : 0;

      const cUsage = podUsage?.containers.find((x) => x.name === cName);
      const cpuUsedMilli = cUsage?.cpuMilli ?? 0;
      const memUsedBytes = cUsage?.memoryBytes ?? 0;

      const status = statuses.find((s) => s.name === cName);
      const restarts = status?.restartCount ?? 0;
      const lastOom = status?.lastState?.terminated?.reason === "OOMKilled";
      const waitingReason = status?.state?.waiting?.reason;

      const hasCpuReq = cpuReqMilli > 0;
      const hasMemReq = memReqBytes > 0;
      const hasCpuLimit = cpuLimitMilli > 0;
      const hasMemLimit = memLimitBytes > 0;
      const hasAnyReq = req !== undefined && (hasCpuReq || hasMemReq);
      const hasAnyLimit = lim !== undefined && (hasCpuLimit || hasMemLimit);

      const memRatio = hasMemLimit ? memUsedBytes / memLimitBytes : 0;
      const oomRisk = (hasMemLimit && memRatio >= 0.9) || lastOom;
      const crashLoop = waitingReason === "CrashLoopBackOff";

      const cpuWaste = hasCpuReq && cpuUsedMilli / cpuReqMilli <= 0.3;
      const memWaste = hasMemReq && memUsedBytes / memReqBytes <= 0.3;
      const overProvisioned = hasAnyReq && (cpuWaste || memWaste);

      const noLimits = !hasAnyLimit;

      const wastedCpuMilli = Math.max(0, cpuReqMilli - cpuUsedMilli);
      const wastedMemBytes = Math.max(0, memReqBytes - memUsedBytes);

      rows.push({
        key: `${namespace}/${podName}/${cName}`,
        namespace,
        pod: podName,
        container: cName,
        cpuReqMilli,
        cpuUsedMilli,
        cpuLimitMilli,
        memReqBytes,
        memUsedBytes,
        memLimitBytes,
        restarts,
        oomRisk,
        crashLoop,
        overProvisioned,
        noLimits,
        wastedCpuMilli,
        wastedMemBytes,
      });
    }
  }
  return rows;
}

function StatusBadges({ row }: { row: Row }) {
  const badges: React.ReactNode[] = [];
  if (row.oomRisk) {
    badges.push(
      <Badge key="oom" tone="err">
        OOM risk
      </Badge>,
    );
  }
  if (row.crashLoop) {
    badges.push(
      <Badge key="crash" tone="err">
        CrashLoop
      </Badge>,
    );
  }
  if (row.overProvisioned) {
    badges.push(
      <Badge key="waste" tone="warn">
        Over-provisioned / waste
      </Badge>,
    );
  }
  if (row.noLimits) {
    badges.push(
      <Badge key="nolimits" tone="warn">
        No limits
      </Badge>,
    );
  }
  if (badges.length === 0) {
    badges.push(
      <Badge key="ok" tone="ok">
        Right-sized
      </Badge>,
    );
  }
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const NUM_CELL = "px-2 py-1 text-right font-mono tabular-nums";
const TH_NUM = "px-2 py-1.5 text-right font-medium";
const TH_TEXT = "px-2 py-1.5 text-left font-medium";

export function FinOpsView({ tab }: { tab: ClusterTab }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    const scope = namespaceScope(tab);

    const load = async () => {
      let pods: KubeObject[] = [];
      let usage: PodUsage[] = [];
      try {
        const all = await api.listResources(
          tab.context,
          POD_GVK,
          scope.queryNamespace,
        );
        pods = all.filter((p) => scope.matches(p.metadata?.namespace));
      } catch (e) {
        useAppStore.getState().reportError(e, tab.context);
      }
      try {
        usage = await api.podUsage(tab.context, scope.queryNamespace);
      } catch (e) {
        useAppStore.getState().reportError(e, tab.context);
      }
      if (cancelled) return;
      setRows(buildRows(pods, usage));
      setLoading(false);
    };

    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab.context, tab.namespaceMode, tab.namespaces.join(",")]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter(
          (r) =>
            r.pod.toLowerCase().includes(q) ||
            r.container.toLowerCase().includes(q) ||
            r.namespace.toLowerCase().includes(q),
        )
      : rows;
    return [...matched].sort((a, b) => {
      if (a.oomRisk !== b.oomRisk) return a.oomRisk ? -1 : 1;
      const aWaste = a.wastedCpuMilli / 1000 + a.wastedMemBytes / 1e9;
      const bWaste = b.wastedCpuMilli / 1000 + b.wastedMemBytes / 1e9;
      return bWaste - aWaste;
    });
  }, [rows, query]);

  const summary = React.useMemo(() => {
    let oom = 0;
    let over = 0;
    let missing = 0;
    let wastedCpuMilli = 0;
    let wastedMemBytes = 0;
    for (const r of rows) {
      if (r.oomRisk) oom++;
      if (r.overProvisioned) over++;
      if (r.noLimits) missing++;
      wastedCpuMilli += r.wastedCpuMilli;
      wastedMemBytes += r.wastedMemBytes;
    }
    return {
      total: rows.length,
      oom,
      over,
      missing,
      wastedVcpu: wastedCpuMilli / 1000,
      wastedMemBytes,
    };
  }, [rows]);

  if (loading) {
    return <CenteredSpinner label="Analyzing pod right-sizing…" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard label="Containers" value={String(summary.total)} />
          <SummaryCard label="OOM risk" value={String(summary.oom)} />
          <SummaryCard label="Over-provisioned" value={String(summary.over)} />
          <SummaryCard label="Missing limits" value={String(summary.missing)} />
          <SummaryCard
            label="Wasted vCPU"
            value={summary.wastedVcpu.toFixed(2)}
            sub="≈ idle reserved"
          />
          <SummaryCard
            label="Wasted memory"
            value={formatBytes(summary.wastedMemBytes)}
            sub="≈ idle reserved"
          />
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by pod, container or namespace…"
          className="max-w-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-muted-foreground">
              <th className={TH_TEXT}>Namespace</th>
              <th className={TH_TEXT}>Pod</th>
              <th className={TH_TEXT}>Container</th>
              <th className={TH_NUM}>CPU req</th>
              <th className={TH_NUM}>CPU used</th>
              <th className={TH_NUM}>CPU limit</th>
              <th className={TH_NUM}>Mem req</th>
              <th className={TH_NUM}>Mem used</th>
              <th className={TH_NUM}>Mem limit</th>
              <th className={TH_TEXT}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-2 py-8 text-center text-muted-foreground"
                >
                  No containers match.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-border/50 hover:bg-accent/40"
                >
                  <td className="px-2 py-1 text-muted-foreground">
                    {r.namespace}
                  </td>
                  <td className="px-2 py-1">{r.pod}</td>
                  <td className="px-2 py-1">{r.container}</td>
                  <td className={NUM_CELL}>{formatCpu(r.cpuReqMilli)}</td>
                  <td className={NUM_CELL}>{formatCpu(r.cpuUsedMilli)}</td>
                  <td className={NUM_CELL}>{formatCpu(r.cpuLimitMilli)}</td>
                  <td className={NUM_CELL}>{formatBytes(r.memReqBytes)}</td>
                  <td className={NUM_CELL}>{formatBytes(r.memUsedBytes)}</td>
                  <td className={NUM_CELL}>{formatBytes(r.memLimitBytes)}</td>
                  <td className="px-2 py-1">
                    <StatusBadges row={r} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
