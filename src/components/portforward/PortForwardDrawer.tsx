import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cable, X, Plus, Square, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useResizableHeight } from "@/components/common/useResizableHeight";
import { api } from "@/lib/api";
import type { PortForwardInfo } from "@/lib/types";
import { useAppStore, shortClusterName } from "@/store/useAppStore";

/** Docked, in-flow port-forward manager (pushes content up like the others). */
export function PortForwardDrawer() {
  const open = useAppStore((s) => s.portForwardOpen);
  const setOpen = useAppStore((s) => s.setPortForwardOpen);
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);
  const { height, startResize } = useResizableHeight("portforward", 260);

  const [forwards, setForwards] = useState<PortForwardInfo[]>([]);
  const [namespace, setNamespace] = useState("default");
  const [pod, setPod] = useState("");
  const [remotePort, setRemotePort] = useState(8080);
  const [localPort, setLocalPort] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setForwards(await api.listPortForwards());
    } catch {
      /* ignore polling errors */
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  const startForward = async () => {
    if (!activeTab || !pod.trim()) {
      pushToast("error", "Open a cluster tab and enter a pod name first.");
      return;
    }
    setBusy(true);
    try {
      const info = await api.startPortForward({
        context: activeTab.context,
        namespace,
        pod: pod.trim(),
        remotePort,
        localPort,
      });
      pushToast("success", `Forwarding ${info.localUrl} → ${info.pod}:${info.remotePort}`);
      setPod("");
      await refresh();
    } catch (e) {
      reportError(e, activeTab.context);
    } finally {
      setBusy(false);
    }
  };

  const stopForward = async (id: string) => {
    try {
      await api.stopPortForward(id);
      await refresh();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="flex w-full shrink-0 flex-col border-t border-border bg-card" style={{ height }}>
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="group flex h-1.5 w-full shrink-0 cursor-row-resize items-center justify-center bg-border/50 transition-colors hover:bg-primary/60"
        title="Drag to resize"
      >
        <div className="h-0.5 w-10 rounded-full bg-muted-foreground/40 group-hover:bg-primary-foreground/70" />
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Cable className="size-4 text-primary" />
        <span className="text-[13px] font-semibold">Port-Forward Manager</span>
        <span className="text-[11px] text-muted-foreground">{forwards.length} active</span>
        <Button size="iconSm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* New forward form */}
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-background/40 p-2">
          <FormField label="Cluster">
            <div className="flex h-8 items-center rounded-md border border-border px-2 text-[12px] text-muted-foreground">
              {activeTab ? shortClusterName(activeTab.context) : "—"}
            </div>
          </FormField>
          <FormField label="Namespace">
            <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} className="w-32" />
          </FormField>
          <FormField label="Pod">
            <Input value={pod} onChange={(e) => setPod(e.target.value)} placeholder="pod-name" className="w-48" />
          </FormField>
          <FormField label="Remote port">
            <Input
              type="number"
              value={remotePort}
              onChange={(e) => setRemotePort(Number(e.target.value))}
              className="w-24"
            />
          </FormField>
          <FormField label="Local port (0=auto)">
            <Input
              type="number"
              value={localPort}
              onChange={(e) => setLocalPort(Number(e.target.value))}
              className="w-24"
            />
          </FormField>
          <Button size="sm" onClick={startForward} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Start
          </Button>
        </div>

        {/* Active forwards */}
        {forwards.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-muted-foreground">No active port-forwards.</p>
        ) : (
          <div className="space-y-1">
            {forwards.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-1.5 text-[12px]"
              >
                <span className={cn("size-2 shrink-0 rounded-full bg-[hsl(var(--ok))]")} />
                <span className="font-mono text-primary">{f.localUrl}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono">
                  {f.namespace}/{f.pod}:{f.remotePort}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {shortClusterName(f.context)}
                </span>
                <Button size="iconSm" variant="ghost" onClick={() => void openUrl(f.localUrl)} title="Open in browser">
                  <ExternalLink />
                </Button>
                <Button size="iconSm" variant="ghost" onClick={() => void stopForward(f.id)} title="Stop">
                  <Square className="text-[hsl(var(--err))]" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
