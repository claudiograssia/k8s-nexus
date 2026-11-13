import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FolderPlus, FolderTree, Lock, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAppStore, type ClusterTab } from "@/store/useAppStore";

// Stable empty reference so the selector never allocates a fresh array (which
// would make Zustand see a "changed" snapshot every render → infinite loop).
const EMPTY: string[] = [];

export function NamespaceSelector({ tab }: { tab: ClusterTab }) {
  const listed = useAppStore((s) => s.namespacesByContext[tab.context]) ?? EMPTY;
  const manual = useAppStore((s) => s.manualNamespaces[tab.context]) ?? EMPTY;
  const forbidden = useAppStore((s) => s.namespacesForbidden[tab.context] === true);
  const defaultNs = useAppStore((s) => s.contextByName(tab.context)?.namespace ?? null);
  const loadNamespaces = useAppStore((s) => s.loadNamespaces);
  const addManualNamespace = useAppStore((s) => s.addManualNamespace);
  const removeManualNamespace = useAppStore((s) => s.removeManualNamespace);
  const updateTab = useAppStore((s) => s.updateTab);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Load namespaces, retrying every 8s while empty — so a cold start with an
  // expired GKE token recovers on its own once auth succeeds (no restart).
  // A 403 is final: the user adds the namespaces they can access by hand.
  useEffect(() => {
    if (listed.length > 0 || forbidden) return;
    void loadNamespaces(tab.context);
    const t = setInterval(() => void loadNamespaces(tab.context), 8000);
    return () => clearInterval(t);
  }, [tab.context, listed.length, forbidden, loadNamespaces]);

  const namespaces = useMemo(() => {
    const set = new Set([...listed, ...manual]);
    if (defaultNs) set.add(defaultNs);
    return [...set].sort();
  }, [listed, manual, defaultNs]);
  const manualSet = useMemo(() => new Set(manual), [manual]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? namespaces.filter((n) => n.toLowerCase().includes(q)) : namespaces;
  }, [namespaces, query]);

  const label = useMemo(() => {
    if (tab.namespaceMode === "all" || tab.namespaces.length === 0) return "All namespaces";
    if (tab.namespaces.length === 1) return tab.namespaces[0];
    return `${tab.namespaces.length} namespaces`;
  }, [tab]);

  const selectAll = () => updateTab(tab.id, { namespaceMode: "all", namespaces: [] });

  // Typed namespaces are added to the context and selected right away.
  const typed = query.trim();
  const canAdd = typed.length > 0 && !namespaces.includes(typed);
  const addTyped = () => {
    if (!canAdd) return;
    addManualNamespace(tab.context, typed);
    const next = tab.namespaceMode === "all" ? [typed] : [...tab.namespaces, typed];
    updateTab(tab.id, { namespaces: next, namespaceMode: next.length === 1 ? "single" : "multi" });
    setQuery("");
  };

  const removeManual = (ns: string) => {
    removeManualNamespace(tab.context, ns);
    if (tab.namespaces.includes(ns)) toggle(ns);
  };

  const toggle = (ns: string) => {
    const has = tab.namespaces.includes(ns);
    const next = has ? tab.namespaces.filter((x) => x !== ns) : [...tab.namespaces, ns];
    updateTab(tab.id, {
      namespaces: next,
      namespaceMode: next.length === 0 ? "all" : next.length === 1 ? "single" : "multi",
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-[160px] justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate">
            <FolderTree className="size-3.5 text-muted-foreground" />
            {label}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTyped();
              }}
              placeholder={forbidden ? "Type a namespace…" : "Search or add namespace…"}
              className="h-7 pl-7 text-[12px]"
            />
          </div>
          {forbidden && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="mt-0.5 size-3 shrink-0" />
              You can't list namespaces on this cluster: add the ones you have access to.
            </p>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <button
            onClick={selectAll}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent",
              tab.namespaceMode === "all" && "text-primary",
            )}
          >
            <span className="flex size-4 items-center justify-center">
              {tab.namespaceMode === "all" && <Check className="size-3.5" />}
            </span>
            All namespaces
          </button>
          {filtered.map((ns) => (
            <label
              key={ns}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
            >
              <Checkbox
                checked={tab.namespaceMode !== "all" && tab.namespaces.includes(ns)}
                onCheckedChange={() => toggle(ns)}
              />
              <span className="truncate">{ns}</span>
              {manualSet.has(ns) && (
                <button
                  title="Remove"
                  onClick={(e) => {
                    e.preventDefault();
                    removeManual(ns);
                  }}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </label>
          ))}
          {canAdd && (
            <button
              onClick={addTyped}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-primary hover:bg-accent"
            >
              <FolderPlus className="size-3.5" />
              Add “{typed}”
            </button>
          )}
          {filtered.length === 0 && !canAdd && (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No namespaces</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
