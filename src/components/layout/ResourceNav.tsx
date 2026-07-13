import { useState } from "react";
import {
  LayoutDashboard,
  DollarSign,
  Network,
  KeyRound,
  ChevronRight,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORIES,
  resourcesByCategory,
  type Category,
} from "@/lib/catalog";
import { useAppStore, shortClusterName, type ClusterTab, type TabView } from "@/store/useAppStore";

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
                        )}
                      >
                        <span className="truncate">{r.label}</span>
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
