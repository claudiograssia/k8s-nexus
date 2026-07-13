import { useEffect, useState } from "react";
import { Cable, Lock, Server, GitBranch, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import type { PortForwardInfo } from "@/lib/types";

export function StatusBar() {
  const summary = useAppStore((s) => s.summary);
  const tabs = useAppStore((s) => s.tabs);
  const safeContexts = useAppStore((s) => s.safeContexts);
  const terminalOpen = useAppStore((s) => s.terminalOpen);
  const setTerminalOpen = useAppStore((s) => s.setTerminalOpen);
  const drawerOpen = useAppStore((s) => s.portForwardOpen);
  const setDrawerOpen = useAppStore((s) => s.setPortForwardOpen);
  const [forwards, setForwards] = useState<PortForwardInfo[]>([]);

  const refresh = async () => {
    try {
      setForwards(await api.listPortForwards());
    } catch {
      /* ignore polling errors */
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, []);

  return (
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card/60 px-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Server className="size-3" /> {summary?.contexts.length ?? 0} clusters
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" /> {tabs.length} sessions
        </span>
        {safeContexts.length > 0 && (
          <span className="flex items-center gap-1 text-[hsl(var(--warn))]">
            <Lock className="size-3" /> {safeContexts.length} in Safe Mode
          </span>
        )}
        <button
          onClick={() => setTerminalOpen(!terminalOpen)}
          className={cn(
            "ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent",
            terminalOpen && "text-primary",
          )}
        >
          <TerminalSquare className="size-3" /> Terminal
        </button>
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent",
            forwards.length > 0 && "text-primary",
          )}
        >
          <Cable className="size-3" /> Port-forwards
          {forwards.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[9px] font-bold text-primary-foreground">
              {forwards.length}
            </span>
          )}
        </button>
      </footer>
  );
}
