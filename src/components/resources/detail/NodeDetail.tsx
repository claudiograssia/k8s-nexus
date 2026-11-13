import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Boxes, Cpu, Info, Lock, MemoryStick, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, MetaBlock } from "./parts";
import { api } from "@/lib/api";
import { CATALOG_BY_ID } from "@/lib/catalog";
import { fetchScoped, isForbidden, isNeedsNamespace, kindOf } from "@/lib/listing";
import { holdsResources, nodeAllocation, percent, podResources, type PodResources } from "@/lib/nodeResources";
import { isAppError, type GvkSpec, type KubeObject, type NodeUsage, type PodUsage } from "@/lib/types";
import { cn, formatBytes, formatCpu, getString } from "@/lib/utils";
import { useResourceList } from "@/components/common/useResourceList";

const POD_GVK: GvkSpec = { group: "", version: "v1", kind: "Pod", plural: "pods", namespaced: true };
const ALL_NAMESPACES = { namespaceMode: "all" as const, namespaces: [] };
const METRICS_MS = 15_000;

const podColumn = (key: string) => CATALOG_BY_ID.get("pods")!.columns.find((c) => c.key === key)!;
const statusCol = podColumn("status");
const restartsCol = podColumn("restarts");

function SectionTitle({ icon: Icon, children }: { icon: typeof Info; children: ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3.5" /> {children}
    </p>
  );
}

/** Live usage of the node and of every pod (metrics-server; polled, may be missing). */
function useNodeMetrics(context: string, node: string) {
  const [nodeUsage, setNodeUsage] = useState<NodeUsage | null>(null);
  const [podUsage, setPodUsage] = useState<Map<string, PodUsage>>(new Map());
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [n, p] = await Promise.allSettled([
        api.nodeUsage(context),
        fetchScoped(context, ALL_NAMESPACES, { id: "metrics.k8s.io/pods", namespaced: true }, "pod metrics", (ns) =>
          api.podUsage(context, ns),
        ),
      ]);
      if (!alive) return;
      if (n.status === "fulfilled") setNodeUsage(n.value.find((u) => u.name === node) ?? null);
      if (p.status === "fulfilled") setPodUsage(new Map(p.value.map((u) => [`${u.namespace}/${u.name}`, u])));
    };
    void load();
    const t = setInterval(() => void load(), METRICS_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [context, node]);
  return { nodeUsage, podUsage };
}

const barTone = (pct: number) =>
  pct > 100 ? "bg-[hsl(var(--err))]" : pct >= 85 ? "bg-[hsl(var(--warn))]" : "bg-primary";

function Bar({ label, value, total, fmt, hint }: { label: string; value: number | null; total: number; fmt: (n: number) => string; hint?: string }) {
  const pct = value === null ? 0 : percent(value, total);
  return (
    <div className="flex items-center gap-2 text-[11px]" title={hint}>
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barTone(pct))} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="w-32 shrink-0 text-right font-mono tabular-nums">
        {value === null ? "—" : `${fmt(value)} · ${Math.round(pct)}%`}
      </span>
    </div>
  );
}

function ResourceBlock({
  icon,
  title,
  allocatable,
  requests,
  limits,
  usage,
  unlimited,
  fmt,
}: {
  icon: typeof Info;
  title: string;
  allocatable: number;
  requests: number;
  limits: number;
  usage: number | null;
  /** Pods with a container that has no limit for this resource. */
  unlimited: number;
  fmt: (n: number) => string;
}) {
  const Icon = icon;
  return (
    <div className="rounded-md border border-border bg-background/50 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px]">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{fmt(allocatable)} allocatable</span>
      </div>
      <div className="space-y-1">
        <Bar label="Requests" value={requests} total={allocatable} fmt={fmt} hint="Reserved by the pods: what the scheduler counts" />
        <Bar label="Limits" value={limits} total={allocatable} fmt={fmt} hint="Above 100% the node is overcommitted" />
        <Bar label="Usage" value={usage} total={allocatable} fmt={fmt} hint="Live, from metrics-server" />
      </div>
      {unlimited > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {unlimited} pod{unlimited === 1 ? "" : "s"} without a {title.toLowerCase()} limit (not counted in Limits): they
          can use whatever the node has free.
        </p>
      )}
    </div>
  );
}

type SortKey = "name" | "cpuReq" | "cpuUse" | "memReq" | "memUse" | "restarts";

interface Row {
  pod: KubeObject;
  key: string;
  res: PodResources;
  cpuUse: number | null;
  memUse: number | null;
  restarts: number;
}

function PodsOnNode({
  rows,
  hidden,
  onOpenPod,
}: {
  rows: Row[];
  hidden: number;
  onOpenPod?: (pod: KubeObject) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cpuReq", desc: true });
  const [q, setQ] = useState("");

  const sorted = useMemo(() => {
    const value = (r: Row): number | string => {
      switch (sort.key) {
        case "name":
          return r.key;
        case "cpuReq":
          return r.res.requests.cpuMilli;
        case "memReq":
          return r.res.requests.memBytes;
        case "cpuUse":
          return r.cpuUse ?? -1;
        case "memUse":
          return r.memUse ?? -1;
        case "restarts":
          return r.restarts;
      }
    };
    const needle = q.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => r.key.toLowerCase().includes(needle)) : rows;
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : va - (vb as number);
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, sort, q]);

  const header = (key: SortKey, label: string, className = "") => (
    <th className={cn("px-1.5 py-1 font-medium", className)}>
      <button
        className="inline-flex items-center gap-0.5 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
      >
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );

  // Usage above the request (CPU) or close to the limit (memory: OOM risk).
  const cpuTone = (r: Row) =>
    r.cpuUse !== null && r.res.requests.cpuMilli > 0 && r.cpuUse > r.res.requests.cpuMilli ? "text-[hsl(var(--warn))]" : "";
  const memTone = (r: Row) => {
    if (r.memUse === null) return "";
    const lim = r.res.limits.memBytes;
    if (!r.res.unlimitedMem && lim > 0 && r.memUse / lim >= 0.9) return "text-[hsl(var(--err))]";
    return r.res.requests.memBytes > 0 && r.memUse > r.res.requests.memBytes ? "text-[hsl(var(--warn))]" : "";
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pods…" className="h-6 pl-6 text-[11px]" />
        </div>
        {hidden > 0 && <span className="text-[11px] text-muted-foreground">{hidden} completed not shown</span>}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              {header("name", "Pod")}
              <th className="px-1.5 py-1 font-medium">Status</th>
              {header("restarts", "Rst", "text-right")}
              {header("cpuReq", "CPU req", "text-right")}
              {header("cpuUse", "CPU use", "text-right")}
              {header("memReq", "Mem req", "text-right")}
              {header("memUse", "Mem use", "text-right")}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r) => {
              const tone = statusCol.tone?.(r.pod) ?? "muted";
              return (
                <tr
                  key={r.key}
                  className={cn("align-top", onOpenPod && "cursor-pointer hover:bg-accent/50")}
                  onClick={() => onOpenPod?.(r.pod)}
                  title={onOpenPod ? "Open this pod" : undefined}
                >
                  <td className="max-w-[180px] px-1.5 py-1">
                    <p className="truncate font-medium" title={r.pod.metadata?.name}>
                      {r.pod.metadata?.name}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">{r.pod.metadata?.namespace}</p>
                  </td>
                  <td className="px-1.5 py-1">
                    <Badge tone={tone}>{statusCol.accessor(r.pod)}</Badge>
                  </td>
                  <td className={cn("px-1.5 py-1 text-right tabular-nums", r.restarts > 0 && "text-[hsl(var(--warn))]")}>
                    {r.restarts}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums">
                    {r.res.requests.cpuMilli ? formatCpu(r.res.requests.cpuMilli) : "—"}
                  </td>
                  <td className={cn("px-1.5 py-1 text-right font-mono tabular-nums", cpuTone(r))}>
                    {r.cpuUse !== null ? formatCpu(r.cpuUse) : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums">
                    {r.res.requests.memBytes ? formatBytes(r.res.requests.memBytes) : "—"}
                  </td>
                  <td className={cn("px-1.5 py-1 text-right font-mono tabular-nums", memTone(r))}>
                    {r.memUse !== null ? formatBytes(r.memUse) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        CPU in orange: using more than requested. Memory in orange: above the request; in red: within 10% of the limit (OOM
        risk).
      </p>
    </div>
  );
}

interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

interface Taint {
  key: string;
  value?: string;
  effect: string;
}

export function NodeDetail({
  context,
  obj,
  onOpenPod,
}: {
  context: string;
  obj: KubeObject;
  onOpenPod?: (pod: KubeObject) => void;
}) {
  const name = obj.metadata?.name ?? "";
  const labels = obj.metadata?.labels ?? {};
  const spec = (obj.spec ?? {}) as { unschedulable?: boolean; taints?: Taint[]; podCIDR?: string };
  const status = (obj.status ?? {}) as {
    conditions?: Condition[];
    addresses?: { type: string; address: string }[];
  };

  const podList = useResourceList({
    context,
    spec: POD_GVK,
    selection: ALL_NAMESPACES,
    fieldSelector: name ? `spec.nodeName=${name}` : null,
    enabled: !!name,
  });
  const { nodeUsage, podUsage } = useNodeMetrics(context, name);

  const alloc = useMemo(() => nodeAllocation(obj, podList.items), [obj, podList.items]);
  const active = useMemo(() => podList.items.filter(holdsResources), [podList.items]);
  const rows: Row[] = useMemo(
    () =>
      active.map((pod) => {
        const key = `${pod.metadata?.namespace ?? ""}/${pod.metadata?.name ?? ""}`;
        const u = podUsage.get(key);
        return {
          pod,
          key,
          res: podResources(pod),
          cpuUse: u ? u.cpuMilli : null,
          memUse: u ? u.memoryBytes : null,
          restarts: Number.parseInt(restartsCol.accessor(pod), 10) || 0,
        };
      }),
    [active, podUsage],
  );

  const conditions = status.conditions ?? [];
  const ready = conditions.find((c) => c.type === "Ready");
  const problems = conditions.filter((c) => (c.type === "Ready" ? c.status !== "True" : c.status === "True"));
  const internalIp = status.addresses?.find((a) => a.type === "InternalIP")?.address;
  const spot = labels["cloud.google.com/gke-spot"] === "true" || labels["cloud.google.com/gke-preemptible"] === "true";
  // Without a cluster-wide pod list the app only sees pods in readable namespaces.
  const partial = isForbidden(context, kindOf(POD_GVK), "");
  const podError = podList.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={ready?.status === "True" ? "ok" : "err"}>{ready?.status === "True" ? "Ready" : "NotReady"}</Badge>
        {spec.unschedulable && <Badge tone="warn">Cordoned</Badge>}
        {spot && <Badge tone="info">Spot</Badge>}
        {labels["cloud.google.com/gke-nodepool"] && <Badge>pool: {labels["cloud.google.com/gke-nodepool"]}</Badge>}
        {labels["node.kubernetes.io/instance-type"] && <Badge>{labels["node.kubernetes.io/instance-type"]}</Badge>}
        {labels["topology.kubernetes.io/zone"] && <Badge>{labels["topology.kubernetes.io/zone"]}</Badge>}
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1">
          {problems.map((c) => (
            <li
              key={c.type}
              className="rounded-md border border-[hsl(var(--err)/0.4)] bg-[hsl(var(--err)/0.06)] p-2 text-[12px]"
            >
              <p className="font-medium">
                {c.type === "Ready" ? "Node not ready" : c.type}
                {c.reason ? ` — ${c.reason}` : ""}
              </p>
              {c.message && <p className="mt-0.5 select-text text-[11px] text-muted-foreground">{c.message}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <ResourceBlock
          icon={Cpu}
          title="CPU"
          allocatable={alloc.allocatable.cpuMilli}
          requests={alloc.requests.cpuMilli}
          limits={alloc.limits.cpuMilli}
          usage={nodeUsage ? nodeUsage.cpuMilli : null}
          unlimited={rows.filter((r) => r.res.unlimitedCpu).length}
          fmt={formatCpu}
        />
        <ResourceBlock
          icon={MemoryStick}
          title="Memory"
          allocatable={alloc.allocatable.memBytes}
          requests={alloc.requests.memBytes}
          limits={alloc.limits.memBytes}
          usage={nodeUsage ? nodeUsage.memoryBytes : null}
          unlimited={rows.filter((r) => r.res.unlimitedMem).length}
          fmt={formatBytes}
        />
        <div className="rounded-md border border-border bg-background/50 p-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="w-16 shrink-0 font-medium text-foreground">Pods</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", barTone(percent(alloc.pods, alloc.allocatable.pods)))}
                style={{ width: `${Math.min(percent(alloc.pods, alloc.allocatable.pods), 100)}%` }}
              />
            </div>
            <span className="w-32 shrink-0 text-right font-mono tabular-nums">
              {alloc.pods} / {alloc.allocatable.pods || "—"}
            </span>
          </div>
        </div>
        {partial && (
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" />
            You cannot list pods in every namespace: only pods in namespaces you can read are shown and counted, so
            requests and limits may be higher than shown.
          </p>
        )}
      </div>

      <div>
        <SectionTitle icon={Boxes}>Pods on this node ({rows.length})</SectionTitle>
        {podError != null && rows.length === 0 ? (
          <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {isNeedsNamespace(podError)
              ? "You cannot list pods across all namespaces. Add a namespace you can read from the namespace selector."
              : isAppError(podError) && podError.kind === "forbidden"
                ? "You are not allowed to list pods."
                : `Could not load pods: ${isAppError(podError) ? podError.message : String(podError)}`}
          </p>
        ) : podList.loading && rows.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Loading pods…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No pods running on this node.</p>
        ) : (
          <PodsOnNode rows={rows} hidden={podList.items.length - active.length} onOpenPod={onOpenPod} />
        )}
      </div>

      {(spec.taints?.length ?? 0) > 0 && (
        <div>
          <SectionTitle icon={Info}>Taints</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {spec.taints!.map((t) => (
              <span key={`${t.key}:${t.effect}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {t.key}
                {t.value ? `=${t.value}` : ""}:{t.effect}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle icon={Info}>System</SectionTitle>
        {internalIp && <Field label="Internal IP">{internalIp}</Field>}
        {spec.podCIDR && <Field label="Pod CIDR">{spec.podCIDR}</Field>}
        <Field label="Kubelet">{getString(obj, "status.nodeInfo.kubeletVersion")}</Field>
        <Field label="OS image">{getString(obj, "status.nodeInfo.osImage")}</Field>
        <Field label="Kernel">{getString(obj, "status.nodeInfo.kernelVersion")}</Field>
        <Field label="Runtime">{getString(obj, "status.nodeInfo.containerRuntimeVersion")}</Field>
        <Field label="Capacity">
          {formatCpu(alloc.capacity.cpuMilli)} CPU · {formatBytes(alloc.capacity.memBytes)} · {alloc.capacity.pods} pods
        </Field>
      </div>

      <MetaBlock obj={obj} />
    </div>
  );
}
