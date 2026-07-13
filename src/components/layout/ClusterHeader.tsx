import { Terminal, Lock, LockOpen, Cloud, Star, MapPin, FolderGit2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { NamespaceSelector } from "./NamespaceSelector";
import { api } from "@/lib/api";
import { useAppStore, shortClusterName, type ClusterTab } from "@/store/useAppStore";

export function ClusterHeader({ tab }: { tab: ClusterTab }) {
  const ctx = useAppStore((s) => s.contextByName(tab.context));
  const setTerminalOpen = useAppStore((s) => s.setTerminalOpen);
  const isSafe = useAppStore((s) => s.isSafe(tab.context));
  const toggleSafeMode = useAppStore((s) => s.toggleSafeMode);
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);
  const addFavorite = useAppStore((s) => s.addFavorite);
  const removeFavorite = useAppStore((s) => s.removeFavorite);
  const favorites = useAppStore((s) => s.favorites);

  const clusterFav = favorites.find((f) => f.kind === "cluster" && f.context === tab.context);

  const openTerminal = async () => {
    try {
      await api.openTerminal(tab.context, null);
      pushToast("info", `Opening system terminal for ${shortClusterName(tab.context)}…`);
    } catch (e) {
      reportError(e, tab.context);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/40 px-4">
      <div className="flex min-w-0 items-center gap-2">
        {ctx?.isGke ? (
          <Cloud className="size-4 text-[hsl(var(--info))]" />
        ) : null}
        <h2 className="truncate text-[15px] font-semibold">{shortClusterName(tab.context)}</h2>
        <button
          onClick={() =>
            clusterFav
              ? removeFavorite(clusterFav.id)
              : addFavorite({
                  kind: "cluster",
                  context: tab.context,
                  label: shortClusterName(tab.context),
                })
          }
        >
          <Star
            className={
              clusterFav
                ? "size-3.5 fill-[hsl(var(--warn))] text-[hsl(var(--warn))]"
                : "size-3.5 text-muted-foreground hover:text-foreground"
            }
          />
        </button>
      </div>

      {ctx?.gkeProject && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <FolderGit2 className="size-3" /> {ctx.gkeProject}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="size-3" /> {ctx.gkeLocation}
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <NamespaceSelector tab={tab} />

        <div className="flex items-center">
          <Hint label="Open the embedded terminal for this cluster">
            <Button
              variant="outline"
              size="sm"
              className="rounded-r-none"
              onClick={() => setTerminalOpen(true)}
            >
              <Terminal className="size-3.5" /> Terminal
            </Button>
          </Hint>
          <Hint label="Open a native OS terminal window instead">
            <Button
              variant="outline"
              size="sm"
              className="rounded-l-none border-l-0 px-2"
              onClick={openTerminal}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </Hint>
        </div>

        <Hint label={isSafe ? "Safe Mode ON — writes blocked" : "Enable Safe Mode (read-only prod lock)"}>
          <button
            onClick={() => void toggleSafeMode(tab.context)}
            className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
          >
            {isSafe ? (
              <Lock className="size-3.5 text-[hsl(var(--warn))]" />
            ) : (
              <LockOpen className="size-3.5 text-muted-foreground" />
            )}
            <span className="text-[12px]">{isSafe ? "Read-only" : "Safe Mode"}</span>
            <Switch checked={isSafe} onCheckedChange={() => void toggleSafeMode(tab.context)} />
          </button>
        </Hint>
      </div>
    </header>
  );
}
