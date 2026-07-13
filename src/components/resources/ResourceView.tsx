import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { CenteredSpinner } from "@/components/ui/spinner";
import { CATALOG_BY_ID } from "@/lib/catalog";
import { api } from "@/lib/api";
import { namespaceScope } from "@/lib/scope";
import { objKey, objNamespace } from "@/lib/utils";
import type { KubeObject } from "@/lib/types";
import { useAppStore, type ClusterTab } from "@/store/useAppStore";
import { ResourceTable, type RowAction } from "./ResourceTable";
import { ResourceDetail } from "./ResourceDetail";
import { ScaleDialog } from "./ScaleDialog";
import { DrainDialog } from "./DrainDialog";
import { PodFilesDialog } from "./PodFilesDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export function ResourceView({ tab }: { tab: ClusterTab }) {
  const resourceType = CATALOG_BY_ID.get(tab.resourceId) ?? CATALOG_BY_ID.get("pods")!;
  const isSafe = useAppStore((s) => s.isSafe(tab.context));
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);

  const [items, setItems] = useState<KubeObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [labelSelector, setLabelSelector] = useState("");
  const [appliedSelector, setAppliedSelector] = useState("");

  const openLogsPanel = useAppStore((s) => s.openLogs);
  const openExec = useAppStore((s) => s.openExecTerminal);
  const [selected, setSelected] = useState<KubeObject | null>(null);
  const [scaleTarget, setScaleTarget] = useState<KubeObject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KubeObject | null>(null);
  const [drainTarget, setDrainTarget] = useState<string | null>(null);
  const [filesTarget, setFilesTarget] = useState<KubeObject | null>(null);

  const scope = useMemo(() => namespaceScope(tab), [tab]);
  const namespacesKey = tab.namespaces.join(",") + tab.namespaceMode;
  const firstLoad = useRef(true);

  const fetchItems = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const raw = await api.listResources(
          tab.context,
          resourceType.gvk,
          scope.queryNamespace,
          appliedSelector || null,
        );
        const filtered = resourceType.gvk.namespaced
          ? raw.filter((o) => scope.matches(objNamespace(o)))
          : raw;

        // Merge live CPU/memory usage (metrics-server) for pods.
        let merged = filtered;
        if (resourceType.podMetrics) {
          try {
            const usage = await api.podUsage(tab.context, scope.queryNamespace);
            const byKey = new Map(usage.map((u) => [`${u.namespace}/${u.name}`, u]));
            merged = filtered.map((o) => {
              const u = byKey.get(`${o.metadata?.namespace ?? ""}/${o.metadata?.name ?? ""}`);
              return u ? { ...o, __cpuMilli: u.cpuMilli, __memBytes: u.memoryBytes } : o;
            });
          } catch {
            /* metrics-server unavailable — CPU/Memory columns stay empty */
          }
        }
        setItems(merged);
      } catch (e) {
        reportError(e, tab.context);
      } finally {
        setLoading(false);
        firstLoad.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.context, resourceType.id, namespacesKey, appliedSelector],
  );

  // Debounce the label selector before it triggers a refetch.
  useEffect(() => {
    const t = setTimeout(() => setAppliedSelector(labelSelector.trim()), 400);
    return () => clearTimeout(t);
  }, [labelSelector]);

  // Reset view state when switching resource kind.
  useEffect(() => {
    setSelected(null);
    setSearch("");
    firstLoad.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType.id]);

  // Fetch + poll.
  useEffect(() => {
    void fetchItems(true);
    const t = setInterval(() => void fetchItems(false), 8000);
    return () => clearInterval(t);
  }, [fetchItems]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((o) => resourceType.columns.some((c) => c.accessor(o).toLowerCase().includes(q)))
      : items;
    if (resourceType.defaultSort) {
      return [...filtered].sort(resourceType.defaultSort);
    }
    return filtered;
  }, [items, search, resourceType]);

  const openLogs = useCallback(
    (obj: KubeObject) => {
      const name = obj.metadata?.name ?? "";
      const ns = objNamespace(obj) ?? "default";
      const containerNames = (spec: Record<string, unknown> | undefined): string[] => {
        const list = (spec?.containers as Array<{ name?: string }> | undefined) ?? [];
        return list.map((c) => c.name).filter((n): n is string => !!n);
      };

      if (resourceType.detail === "pod") {
        openLogsPanel({
          context: tab.context,
          namespace: ns,
          title: name,
          pods: [name],
          containers: containerNames(obj.spec as Record<string, unknown> | undefined),
        });
      } else {
        const workloadSpec = obj.spec as Record<string, unknown> | undefined;
        const matchLabels =
          (workloadSpec?.selector as { matchLabels?: Record<string, string> } | undefined)
            ?.matchLabels ?? {};
        const selector = Object.entries(matchLabels)
          .map(([k, v]) => `${k}=${v}`)
          .join(",");
        const template = workloadSpec?.template as Record<string, unknown> | undefined;
        openLogsPanel({
          context: tab.context,
          namespace: ns,
          title: `${resourceType.gvk.kind}/${name}`,
          labelSelector: selector,
          containers: containerNames(template?.spec as Record<string, unknown> | undefined),
        });
      }
    },
    [resourceType, tab.context, openLogsPanel],
  );

  const handleAction = useCallback(
    async (action: RowAction, obj: KubeObject) => {
      const name = obj.metadata?.name ?? "";
      const ns = objNamespace(obj) ?? null;
      switch (action) {
        case "edit":
          setSelected(obj);
          break;
        case "logs":
          openLogs(obj);
          break;
        case "scale":
          setScaleTarget(obj);
          break;
        case "delete":
          setDeleteTarget(obj);
          break;
        case "restart":
          try {
            await api.restartResource(tab.context, resourceType.gvk, ns, name);
            pushToast("success", `Restarting ${resourceType.gvk.kind}/${name}`);
            void fetchItems(false);
          } catch (e) {
            reportError(e, tab.context);
          }
          break;
        case "exec":
        case "attach": {
          const containers =
            ((obj.spec as Record<string, unknown> | undefined)?.containers as
              | Array<{ name?: string }>
              | undefined)?.map((c) => c.name).filter((n): n is string => !!n) ?? [];
          const container = containers.length > 1 ? containers[0] : undefined;
          openExec({
            context: tab.context,
            namespace: ns ?? "default",
            pod: name,
            container,
            mode: action,
            title: container ? `${name}:${container}` : name,
          });
          break;
        }
        case "trigger":
          try {
            const jobName = await api.triggerCronjob(tab.context, ns ?? "default", name);
            pushToast("success", `Triggered job ${jobName}`);
            void fetchItems(false);
          } catch (e) {
            reportError(e, tab.context);
          }
          break;
        case "cordon":
        case "uncordon":
          try {
            await api.cordonNode(tab.context, name, action === "cordon");
            pushToast("success", `${action === "cordon" ? "Cordoned" : "Uncordoned"} ${name}`);
            void fetchItems(false);
          } catch (e) {
            reportError(e, tab.context);
          }
          break;
        case "drain":
          setDrainTarget(name);
          break;
        case "files":
          setFilesTarget(obj);
          break;
      }
    },
    [openLogs, openExec, resourceType.gvk, tab.context, pushToast, reportError, fetchItems],
  );

  const podContainerNames = (o: KubeObject | null): string[] =>
    ((o?.spec as Record<string, unknown> | undefined)?.containers as Array<{ name?: string }> | undefined)
      ?.map((c) => c.name)
      .filter((n): n is string => !!n) ?? [];

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.metadata?.name ?? "";
    try {
      await api.deleteResource(tab.context, resourceType.gvk, objNamespace(deleteTarget) ?? null, name);
      pushToast("success", `Deleted ${resourceType.gvk.kind}/${name}`);
      if (selected && objKey(selected) === objKey(deleteTarget)) setSelected(null);
      void fetchItems(false);
    } catch (e) {
      reportError(e, tab.context);
    }
  };

  const currentReplicas =
    scaleTarget && typeof (scaleTarget.spec as Record<string, unknown>)?.replicas === "number"
      ? ((scaleTarget.spec as Record<string, unknown>).replicas as number)
      : 0;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header / toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h3 className="text-[13px] font-semibold">{resourceType.label}</h3>
          <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{visible.length}</span>
          {isSafe && (
            <span className="rounded bg-[hsl(var(--warn)/0.15)] px-1.5 text-[10px] text-[hsl(var(--warn))]">
              read-only
            </span>
          )}
          <div className="relative ml-auto w-56">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-7 pl-7 text-[12px]"
            />
          </div>
          <div className="relative w-56">
            <Tag className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={labelSelector}
              onChange={(e) => setLabelSelector(e.target.value)}
              placeholder="Label selector (app=x)"
              className="h-7 pl-7 font-mono text-[12px]"
            />
          </div>
          <Hint label="Refresh">
            <Button size="iconSm" variant="ghost" onClick={() => void fetchItems(true)}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </Hint>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1">
          {loading && firstLoad.current ? (
            <CenteredSpinner label={`Loading ${resourceType.label}…`} />
          ) : (
            <ResourceTable
              resourceType={resourceType}
              items={visible}
              selectedKey={selected ? objKey(selected) : null}
              readOnly={isSafe}
              onRowClick={(o) => setSelected(o)}
              onAction={handleAction}
            />
          )}
        </div>
      </div>

      {selected && (
        <ResourceDetail
          context={tab.context}
          resourceType={resourceType}
          obj={selected}
          readOnly={isSafe}
          onClose={() => setSelected(null)}
          onOpenLogs={openLogs}
          onScale={(o) => setScaleTarget(o)}
          onRestart={(o) => void handleAction("restart", o)}
          onExec={(o) => void handleAction("exec", o)}
          onFiles={(o) => setFilesTarget(o)}
        />
      )}

      {filesTarget && (
        <PodFilesDialog
          open={!!filesTarget}
          onOpenChange={(v) => !v && setFilesTarget(null)}
          context={tab.context}
          namespace={objNamespace(filesTarget) ?? "default"}
          pod={filesTarget.metadata?.name ?? ""}
          containers={podContainerNames(filesTarget)}
        />
      )}

      {scaleTarget && (
        <ScaleDialog
          open={!!scaleTarget}
          onOpenChange={(v) => !v && setScaleTarget(null)}
          context={tab.context}
          spec={resourceType.gvk}
          namespace={objNamespace(scaleTarget) ?? null}
          name={scaleTarget.metadata?.name ?? ""}
          current={currentReplicas}
          onDone={() => {
            setScaleTarget(null);
            void fetchItems(false);
          }}
        />
      )}

      {drainTarget && (
        <DrainDialog
          open={!!drainTarget}
          onOpenChange={(v) => !v && setDrainTarget(null)}
          context={tab.context}
          node={drainTarget}
          onDone={() => {
            setDrainTarget(null);
            void fetchItems(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete ${resourceType.gvk.kind}?`}
        description={`This will permanently delete ${deleteTarget?.metadata?.name ?? ""}. This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
