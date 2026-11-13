import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  DollarSign,
  Network,
  KeyRound,
  ChevronRight,
  Star,
  Lock,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATALOG,
  CATEGORIES,
  discoveredId,
  inCatalog,
  resourceTypeById,
  resourcesByCategory,
  type Category,
  type ResourceType,
} from "@/lib/catalog";
import { usePermissions } from "@/lib/permissions";
import type { AccessCheck } from "@/lib/types";
import { useAppStore, shortClusterName, type ClusterTab, type TabView } from "@/store/useAppStore";

const EMPTY: string[] = [];

const VIEWS: { id: TabView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "finops", label: "FinOps / Right-Sizing", icon: DollarSign },
  { id: "networking", label: "Networking (GKE)", icon: Network },
  { id: "iam", label: "IAM & Workload Identity", icon: KeyRound },
];

export function ResourceNav({ tab }: { tab: ClusterTab }) {
  const updateTab = useAppStore((s) => s.updateTab);
  // Dim the kinds the user cannot list anywhere in the current selection.
  const perms = usePermissions(tab.context);
  const manual = useAppStore((s) => s.manualNamespaces[tab.context]) ?? EMPTY;
  const defaultNs = useAppStore((s) => s.contextByName(tab.context)?.namespace ?? null);
  const scopes = useMemo(() => {
    if (tab.namespaceMode !== "all" && tab.namespaces.length > 0) return tab.namespaces;
    return [...new Set(["", ...manual, ...(defaultNs ? [defaultNs] : [])])];
  }, [tab.namespaceMode, tab.namespaces, manual, defaultNs]);
  const listChecks = useMemo(
    () => (r: ResourceType): AccessCheck[] =>
      (r.gvk.namespaced ? scopes : [""]).map((ns) => ({
        group: r.gvk.group,
        resource: r.gvk.plural,
        verb: "list",
        namespace: ns || null,
      })),
    [scopes],
  );
  useEffect(() => {
    void perms.ensure(CATALOG.flatMap(listChecks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.context, listChecks]);

  const [collapsed, setCollapsed] = useState<Record<Category, boolean>>({
    Cluster: false,
    Workloads: false,
    Config: false,
    Storage: true,
    Network: true,
    "Access Control": true,
    GKE: true,
  });

  return (
    <nav className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-card/20 py-2">
      <div className="px-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => updateTab(tab.id, { view: v.id })}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
              tab.view === v.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <v.icon className="size-4" />
            {v.label}
          </button>
        ))}
      </div>

      <div className="mt-2 border-t border-border pt-2">
        {CATEGORIES.map((cat) => {
          const items = resourcesByCategory(cat);
          const isCollapsed = collapsed[cat];
          return (
            <div key={cat}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn("size-3 transition-transform", !isCollapsed && "rotate-90")}
                />
                {cat}
              </button>
              {!isCollapsed && (
                <div className="pb-1">
                  {items.map((r) => (
                    <NavItem key={r.id} tab={tab} r={r} denied={perms.deniedAll(listChecks(r))} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <DiscoveredSection tab={tab} listChecks={listChecks} />
    </nav>
  );
}

function NavItem({
  tab,
  r,
  denied,
  title,
  indent = "pl-6",
}: {
  tab: ClusterTab;
  r: ResourceType;
  denied: boolean;
  title?: string;
  indent?: string;
}) {
  const updateTab = useAppStore((s) => s.updateTab);
  const favorites = useAppStore((s) => s.favorites);
  const addFavorite = useAppStore((s) => s.addFavorite);
  const removeFavorite = useAppStore((s) => s.removeFavorite);
  const active = tab.view === "resources" && tab.resourceId === r.id;
  const fav = favorites.find(
    (f) => f.kind === "resource" && f.context === tab.context && f.resourceId === r.id,
  );
  return (
    <div
      onClick={() => updateTab(tab.id, { view: "resources", resourceId: r.id })}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 text-[12px] transition-colors",
        indent,
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        denied && !active && "opacity-45",
      )}
      title={denied ? "You are not allowed to list this resource here" : title}
    >
      <span className="truncate">{r.label}</span>
      {denied && <Lock className="size-3 shrink-0" />}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (fav) removeFavorite(fav.id);
          else
            addFavorite({
              kind: "resource",
              context: tab.context,
              resourceId: r.id,
              label: `${r.label} · ${shortClusterName(tab.context)}`,
            });
        }}
        className={cn("ml-auto opacity-0 group-hover:opacity-100", fav && "opacity-100")}
      >
        <Star
          className={cn(
            "size-3",
            fav ? "fill-[hsl(var(--warn))] text-[hsl(var(--warn))]" : "text-muted-foreground",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Every other listable kind the cluster serves (CRDs and built-ins not in the
 * catalog), grouped by API group. Permissions are checked only for the groups
 * that are open.
 */
function DiscoveredSection({
  tab,
  listChecks,
}: {
  tab: ClusterTab;
  listChecks: (r: ResourceType) => AccessCheck[];
}) {
  const discovery = useAppStore((s) => s.discovery[tab.context]);
  const loadDiscovery = useAppStore((s) => s.loadDiscovery);
  const perms = usePermissions(tab.context);
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void loadDiscovery(tab.context);
  }, [tab.context, loadDiscovery]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = new Map<string, ResourceType[]>();
    for (const d of discovery?.resources ?? []) {
      if (inCatalog(d)) continue;
      if (q && !`${d.kind} ${d.plural} ${d.group}`.toLowerCase().includes(q)) continue;
      const rt = resourceTypeById(discoveredId(d));
      if (!rt) continue;
      const key = d.group || "core";
      out.set(key, [...(out.get(key) ?? []), rt]);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [discovery, filter]);

  const filtering = filter.trim() !== "";
  const expanded = (g: string) => filtering || !!openGroups[g];
  const visible = useMemo(
    () => (open ? groups.filter(([g]) => expanded(g)).flatMap(([, items]) => items) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, groups, openGroups, filtering],
  );
  useEffect(() => {
    if (visible.length > 0) void perms.ensure(visible.slice(0, 60).flatMap(listChecks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, listChecks]);

  const total = groups.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="mt-1 border-t border-border pt-2">
      <div className="flex items-center pr-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          API Resources
          {discovery && <span className="font-normal normal-case">({total})</span>}
        </button>
        {open && (
          <button
            onClick={() => void loadDiscovery(tab.context, true)}
            title="Rediscover APIs"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="pb-2">
          <div className="px-2 py-1">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter kinds…"
              className="h-6 w-full rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
            />
          </div>
          {!discovery && <p className="px-6 py-1 text-[11px] text-muted-foreground">Discovering…</p>}
          {groups.map(([group, items]) => (
            <div key={group}>
              <button
                onClick={() => setOpenGroups((o) => ({ ...o, [group]: !o[group] }))}
                className="flex w-full items-center gap-1 py-0.5 pl-4 pr-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
                title={group}
              >
                <ChevronRight className={cn("size-3 shrink-0 transition-transform", expanded(group) && "rotate-90")} />
                <span className="truncate">{group}</span>
                <span className="ml-auto text-[10px]">{items.length}</span>
              </button>
              {expanded(group) &&
                items.map((r) => (
                  <NavItem
                    key={r.id}
                    tab={tab}
                    r={r}
                    indent="pl-9"
                    denied={perms.deniedAll(listChecks(r))}
                    title={`${r.gvk.group || "core"}/${r.gvk.version} · ${r.gvk.plural}`}
                  />
                ))}
            </div>
          ))}
          {discovery && discovery.failed.length > 0 && (
            <p className="px-4 pt-1 text-[10px] text-muted-foreground" title={discovery.failed.join("\n")}>
              {discovery.failed.length} API group(s) unavailable
            </p>
          )}
        </div>
      )}
    </div>
  );
}
