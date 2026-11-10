import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  DollarSign,
  Network,
  KeyRound,
  ChevronRight,
  Star,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATALOG,
  CATEGORIES,
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
  const favorites = useAppStore((s) => s.favorites);
  const addFavorite = useAppStore((s) => s.addFavorite);
  const removeFavorite = useAppStore((s) => s.removeFavorite);
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
                  {items.map((r) => {
                    const active = tab.view === "resources" && tab.resourceId === r.id;
                    const denied = perms.deniedAll(listChecks(r));
                    const fav = favorites.find(
                      (f) => f.kind === "resource" && f.context === tab.context && f.resourceId === r.id,
                    );
                    return (
                      <div
                        key={r.id}
                        onClick={() => updateTab(tab.id, { view: "resources", resourceId: r.id })}
                        className={cn(
                          "group flex cursor-pointer items-center gap-2 rounded-md py-1 pl-6 pr-2 text-[12px] transition-colors",
                          active
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                          denied && !active && "opacity-45",
                        )}
                        title={denied ? "You are not allowed to list this resource here" : undefined}
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
                              fav
                                ? "fill-[hsl(var(--warn))] text-[hsl(var(--warn))]"
                                : "text-muted-foreground",
                            )}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
