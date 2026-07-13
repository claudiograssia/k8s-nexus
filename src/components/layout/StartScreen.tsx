import { Boxes, Cloud, Server, ArrowRight } from "lucide-react";
import { useAppStore, shortClusterName } from "@/store/useAppStore";
import { CenteredSpinner } from "@/components/ui/spinner";

export function StartScreen() {
  const summary = useAppStore((s) => s.summary);
  const loading = useAppStore((s) => s.contextsLoading);
  const openTab = useAppStore((s) => s.openTab);

  if (loading && !summary) return <CenteredSpinner label="Reading kubeconfig…" />;

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-8">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Boxes className="size-7" />
        </div>
        <h1 className="text-xl font-semibold">KubeNexus GKE</h1>
        <p className="text-[13px] text-muted-foreground">
          Multi-cluster Kubernetes IDE — pick a cluster to open a session.
        </p>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
        {(summary?.contexts ?? []).map((c) => (
          <button
            key={c.name}
            onClick={() => openTab(c.name)}
            className="group flex items-center gap-3 rounded-lg border border-border bg-card/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            {c.isGke ? (
              <Cloud className="size-5 text-[hsl(var(--info))]" />
            ) : (
              <Server className="size-5 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium">{shortClusterName(c.name)}</span>
                {c.isCurrent && (
                  <span className="rounded bg-primary/15 px-1 text-[9px] text-primary">current</span>
                )}
              </div>
              <span className="block truncate text-[11px] text-muted-foreground">
                {c.gkeProject ? `${c.gkeProject} · ${c.gkeLocation}` : c.server ?? c.cluster}
              </span>
            </div>
            <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>

      {summary && summary.sources.length > 0 && (
        <p className="mt-6 text-[11px] text-muted-foreground">
          kubeconfig: {summary.sources.join(", ")}
        </p>
      )}
    </div>
  );
}
