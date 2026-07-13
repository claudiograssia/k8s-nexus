import { useMemo, useState } from "react";
import { Star, Server, Search, RefreshCw, Cloud, Boxes, FolderTree } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { useAppStore, shortClusterName, type Favorite } from "@/store/useAppStore";

export function Sidebar() {
  const summary = useAppStore((s) => s.summary);
  const loading = useAppStore((s) => s.contextsLoading);
  const loadContexts = useAppStore((s) => s.loadContexts);
  const openTab = useAppStore((s) => s.openTab);
  const favorites = useAppStore((s) => s.favorites);
  const addFavorite = useAppStore((s) => s.addFavorite);
  const removeFavorite = useAppStore((s) => s.removeFavorite);
  const isFavorite = useAppStore((s) => s.isFavorite);
  const [query, setQuery] = useState("");

  const contexts = useMemo(() => {
    const list = summary?.contexts ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [summary, query]);

  const openFavorite = (f: Favorite) => {
    openTab(f.context, {
      view: f.kind === "resource" ? "resources" : "dashboard",
      resourceId: f.resourceId,
      namespace: f.namespace,
    });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-2 p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter clusters…"
            className="h-7 pl-7 text-[12px]"
          />
        </div>
        <Hint label="Reload kubeconfig">
          <Button size="iconSm" variant="ghost" onClick={() => void loadContexts()}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </Hint>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {favorites.length > 0 && (
          <section className="mb-2">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Favorites
            </p>
            {favorites.map((f) => (
              <div
                key={f.id}
                onClick={() => openFavorite(f)}
                className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-accent/50"
              >
                {f.kind === "resource" ? (
                  <Boxes className="size-3.5 text-primary" />
                ) : f.kind === "namespace" ? (
                  <FolderTree className="size-3.5 text-primary" />
                ) : (
                  <Server className="size-3.5 text-primary" />
                )}
                <span className="truncate">{f.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(f.id);
                  }}
                  className="ml-auto opacity-0 group-hover:opacity-100"
                >
                  <Star className="size-3.5 fill-[hsl(var(--warn))] text-[hsl(var(--warn))]" />
                </button>
              </div>
            ))}
          </section>
        )}

        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Clusters ({contexts.length})
        </p>
        {contexts.map((c) => {
          const fav = isFavorite({ kind: "cluster", context: c.name });
          return (
            <div
              key={c.name}
              onClick={() => openTab(c.name)}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
            >
              {c.isGke ? (
                <Cloud className="size-3.5 shrink-0 text-[hsl(var(--info))]" />
              ) : (
                <Server className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px]">{shortClusterName(c.name)}</span>
                  {c.isCurrent && (
                    <span className="rounded bg-primary/15 px-1 text-[9px] text-primary">current</span>
                  )}
                </div>
                {c.gkeProject && (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {truncate(`${c.gkeProject} · ${c.gkeLocation}`, 30)}
                  </span>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (fav) {
                    const existing = favorites.find(
                      (x) => x.kind === "cluster" && x.context === c.name,
                    );
                    if (existing) removeFavorite(existing.id);
                  } else {
                    addFavorite({
                      kind: "cluster",
                      context: c.name,
                      label: shortClusterName(c.name),
                    });
                  }
                }}
                className={cn(
                  "shrink-0 opacity-0 group-hover:opacity-100",
                  fav && "opacity-100",
                )}
              >
                <Star
                  className={cn(
                    "size-3.5",
                    fav
                      ? "fill-[hsl(var(--warn))] text-[hsl(var(--warn))]"
                      : "text-muted-foreground",
                  )}
                />
              </button>
            </div>
          );
        })}
        {contexts.length === 0 && !loading && (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            No clusters found in kubeconfig.
          </p>
        )}
      </div>
    </aside>
  );
}
