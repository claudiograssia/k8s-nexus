import { useEffect, useState } from "react";
import { Loader2, Minus, Plus, Activity } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { GvkSpec, KubeObject } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: string;
  spec: GvkSpec;
  namespace: string | null;
  name: string;
  current: number;
  onDone: () => void;
}

const HPA_GVK: GvkSpec = {
  group: "autoscaling",
  version: "v2",
  kind: "HorizontalPodAutoscaler",
  plural: "horizontalpodautoscalers",
  namespaced: true,
};

interface HpaInfo {
  name: string;
  min: number;
  max: number;
  current: number;
}

function matchingHpa(hpas: KubeObject[], targetKind: string, targetName: string): HpaInfo | null {
  for (const h of hpas) {
    const hspec = h.spec as Record<string, unknown> | undefined;
    const ref = hspec?.["scaleTargetRef"] as { kind?: string; name?: string } | undefined;
    if (ref?.kind === targetKind && ref?.name === targetName) {
      const status = h.status as Record<string, unknown> | undefined;
      return {
        name: h.metadata?.name ?? "hpa",
        min: typeof hspec?.["minReplicas"] === "number" ? (hspec["minReplicas"] as number) : 1,
        max: typeof hspec?.["maxReplicas"] === "number" ? (hspec["maxReplicas"] as number) : 0,
        current:
          typeof status?.["currentReplicas"] === "number" ? (status["currentReplicas"] as number) : 0,
      };
    }
  }
  return null;
}

export function ScaleDialog({ open, onOpenChange, context, spec, namespace, name, current, onDone }: Props) {
  const [replicas, setReplicas] = useState(current);
  const [busy, setBusy] = useState(false);
  const [hpa, setHpa] = useState<HpaInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);

  // On open, detect whether an HPA already manages this workload.
  useEffect(() => {
    if (!open) return;
    setReplicas(current);
    setHpa(null);
    setChecking(true);
    let alive = true;
    (async () => {
      try {
        const hpas = await api.listResources(context, HPA_GVK, namespace);
        if (alive) setHpa(matchingHpa(hpas, spec.kind, name));
      } catch {
        // HPA API may be unavailable — treat as "not HPA-managed".
        if (alive) setHpa(null);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, context, namespace, name, spec.kind, current]);

  const run = async () => {
    setBusy(true);
    try {
      await api.scaleResource(context, spec, namespace, name, replicas);
      pushToast("success", `Scaled ${spec.kind}/${name} to ${replicas} replicas`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      reportError(e, context);
    } finally {
      setBusy(false);
    }
  };

  const locked = !!hpa;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Scale {name}</DialogTitle>
          <DialogDescription>
            Set the desired replica count for this {spec.kind}.
          </DialogDescription>
        </DialogHeader>

        {checking ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Checking for a managing HPA…
          </div>
        ) : locked ? (
          <div className="rounded-md border border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.12)] p-3">
            <div className="mb-1 flex items-center gap-2">
              <Activity className="size-4 text-[hsl(var(--warn))]" />
              <span className="text-[12px] font-semibold text-foreground">Managed by HorizontalPodAutoscaler</span>
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{hpa!.name}</span> controls the replica count — manual
              scaling would be immediately overridden. Adjust the HPA instead.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">min {hpa!.min}</Badge>
              <Badge tone="info">max {hpa!.max}</Badge>
              <Badge tone="ok">current {hpa!.current}</Badge>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 py-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setReplicas((r) => Math.max(0, r - 1))}
              disabled={replicas <= 0}
            >
              <Minus />
            </Button>
            <Input
              type="number"
              min={0}
              value={replicas}
              onChange={(e) => setReplicas(Math.max(0, Number(e.target.value)))}
              className="w-24 text-center text-base font-semibold"
            />
            <Button size="icon" variant="outline" onClick={() => setReplicas((r) => r + 1)}>
              <Plus />
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {locked ? "Close" : "Cancel"}
          </Button>
          {!locked && (
            <Button size="sm" onClick={run} disabled={busy || checking || replicas === current}>
              {busy && <Loader2 className="animate-spin" />} Scale to {replicas}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
