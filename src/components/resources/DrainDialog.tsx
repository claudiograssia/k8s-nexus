import { useEffect, useState } from "react";
import { Loader2, Droplets } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { DrainPod } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: string;
  node: string;
  onDone: () => void;
}

export function DrainDialog({ open, onOpenChange, context, node, onDone }: Props) {
  const [pods, setPods] = useState<DrainPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPods([]);
    let alive = true;
    (async () => {
      try {
        const list = await api.drainPreview(context, node);
        if (alive) setPods(list);
      } catch (e) {
        if (alive) reportError(e, context);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, context, node, reportError]);

  const run = async () => {
    setBusy(true);
    try {
      const count = await api.drainNode(context, node);
      pushToast("success", `Cordoned ${node} and evicted ${count} pod(s)`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      reportError(e, context);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="size-4 text-primary" /> Drain node {node}
          </DialogTitle>
          <DialogDescription>
            The node will be <b>cordoned</b> (marked unschedulable) and the pods below will be{" "}
            <b>evicted</b>. DaemonSet-managed and static pods are left in place.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-auto rounded-md border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Computing affected pods…
            </div>
          ) : pods.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              No evictable pods on this node.
            </p>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-1.5 font-medium">Namespace</th>
                  <th className="px-3 py-1.5 font-medium">Pod</th>
                  <th className="px-3 py-1.5 font-medium">Controlled by</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => (
                  <tr key={`${p.namespace}/${p.name}`} className="border-b border-border/50">
                    <td className="px-3 py-1.5">{p.namespace}</td>
                    <td className="px-3 py-1.5 font-mono">{p.name}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={p.controller ? "muted" : "warn"}>
                        {p.controller || "bare pod"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={run} disabled={busy || loading}>
            {busy && <Loader2 className="animate-spin" />} Cordon &amp; Drain ({pods.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
