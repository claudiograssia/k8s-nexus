import { useState } from "react";
import { X, Boxes, Circle, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { SettingsDialog } from "@/components/SettingsDialog";

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const isSafe = useAppStore((s) => s.safeContexts);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card/60">
      <div className="flex items-center gap-2 px-3 text-primary">
        <Boxes className="size-4" />
        <span className="text-[13px] font-semibold tracking-tight">KubeNexus</span>
        <span className="rounded bg-primary/15 px-1 text-[10px] font-bold text-primary">GKE</span>
      </div>
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const safe = isSafe.includes(tab.context);
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group flex max-w-[220px] cursor-pointer items-center gap-2 border-r border-border px-3 text-[13px] transition-colors",
                tab.id === activeTabId
                  ? "bg-background text-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-accent/40",
              )}
            >
              <Circle
                className={cn(
                  "size-2 shrink-0",
                  safe ? "fill-[hsl(var(--warn))] text-[hsl(var(--warn))]" : "fill-primary text-primary",
                )}
              />
              <span className="truncate">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-auto rounded-sm p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setSettingsOpen(true)}
        className="flex items-center px-3 text-muted-foreground hover:text-foreground"
        title="Settings"
      >
        <Settings className="size-4" />
      </button>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
