import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FolderTree, Search } from "lucide-react";
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
  const namespaces = useAppStore((s) => s.namespacesByContext[tab.context]) ?? EMPTY;
  const loadNamespaces = useAppStore((s) => s.loadNamespaces);
  const updateTab = useAppStore((s) => s.updateTab);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Load namespaces, retrying every 8s while empty — so a cold start with an
  // expired GKE token recovers on its own once auth succeeds (no restart).
  useEffect(() => {
    if (namespaces.length > 0) return;
    void loadNamespaces(tab.context);
    const t = setInterval(() => void loadNamespaces(tab.context), 8000);
    return () => clearInterval(t);
  }, [tab.context, namespaces.length, loadNamespaces]);

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
              placeholder="Search namespaces…"
              className="h-7 pl-7 text-[12px]"
            />
          </div>
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
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No namespaces</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
