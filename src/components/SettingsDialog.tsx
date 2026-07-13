import { useEffect, useState } from "react";
import { Check, X as XIcon, RefreshCw, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/useAppStore";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const savedPath = useAppStore((s) => s.kubeconfigPath);
  const applyKubeconfigPath = useAppStore((s) => s.applyKubeconfigPath);
  const summary = useAppStore((s) => s.summary);
  const tools = useAppStore((s) => s.tools);
  const loadTools = useAppStore((s) => s.loadTools);

  const [path, setPath] = useState(savedPath);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setPath(savedPath);
  }, [open, savedPath]);

  const apply = async (value: string) => {
    setBusy(true);
    try {
      await applyKubeconfigPath(value);
    } finally {
      setBusy(false);
    }
  };

  const ToolRow = ({ name, ok }: { name: string; ok: boolean }) => (
    <div className="flex items-center gap-2 text-[12px]">
      {ok ? (
        <Check className="size-3.5 text-[hsl(var(--ok))]" />
      ) : (
        <XIcon className="size-3.5 text-[hsl(var(--err))]" />
      )}
      <span className="font-mono">{name}</span>
      <span className={ok ? "text-[hsl(var(--ok))]" : "text-[hsl(var(--err))]"}>
        {ok ? "found" : "not found"}
      </span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Kubeconfig location and required tooling.</DialogDescription>
        </DialogHeader>

        {/* Kubeconfig path */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Kubeconfig path
          </p>
          <p className="text-[11px] text-muted-foreground">
            Leave empty to use the default (<span className="font-mono">~/.kube/config</span>, i.e.{" "}
            <span className="font-mono">C:\Users\&lt;you&gt;\.kube\config</span> on Windows) plus the{" "}
            <span className="font-mono">KUBECONFIG</span> env var.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. D:\configs\prod-kubeconfig.yaml"
              className="font-mono text-[12px]"
            />
            <Button size="sm" onClick={() => void apply(path)} disabled={busy}>
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPath("");
                void apply("");
              }}
              disabled={busy || !savedPath}
              title="Reset to default"
            >
              <RotateCcw />
            </Button>
          </div>
          {summary && summary.sources.length > 0 && (
            <p className="break-all text-[11px] text-muted-foreground">
              Active source(s): <span className="font-mono">{summary.sources.join(", ")}</span>
            </p>
          )}
        </div>

        {/* Tooling */}
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Required tools
            </p>
            <Button size="iconSm" variant="ghost" className="ml-auto" onClick={() => void loadTools()}>
              <RefreshCw />
            </Button>
          </div>
          {tools ? (
            <div className="space-y-1">
              <ToolRow name="kubectl" ok={tools.kubectl} />
              <ToolRow name="gcloud" ok={tools.gcloud} />
              <ToolRow name="gke-gcloud-auth-plugin" ok={tools.gkeAuthPlugin} />
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Checking…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
