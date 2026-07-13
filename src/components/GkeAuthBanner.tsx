import { useState } from "react";
import { ShieldAlert, RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";

/**
 * Auto-healing banner for expired GKE tokens. When a command against this
 * cluster fails with `gkeAuth`, the store records a prompt and this banner
 * offers a one-click `gcloud auth login` (in a native terminal) plus a
 * "re-check" that invalidates the cached client so the next call re-auths.
 */
export function GkeAuthBanner({ tabContext }: { tabContext: string }) {
  const prompt = useAppStore((s) => s.gkeAuthPrompt);
  const setPrompt = useAppStore((s) => s.setGkeAuthPrompt);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  if (!prompt || prompt.context !== tabContext) return null;

  const login = async () => {
    try {
      await api.gcloudLogin();
      pushToast("info", "Opened gcloud auth login in a terminal. Complete the browser flow, then click Re-check.");
    } catch (e) {
      pushToast("error", `Could not launch gcloud: ${String(e)}`);
    }
  };

  const recheck = async () => {
    setBusy(true);
    try {
      await api.invalidateClient(prompt.context);
      await api.gcloudCheck();
      setPrompt(null);
      pushToast("success", "GKE credentials refreshed.");
    } catch {
      pushToast("error", "Still unauthenticated — finish the gcloud login flow first.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.12)] px-4 py-2 text-[hsl(var(--warn))]">
      <ShieldAlert className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">GKE authentication expired</p>
        <p className="truncate text-[11px] text-muted-foreground">{prompt.message}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={login}>
        <LogIn className="size-3.5" /> gcloud auth login
      </Button>
      <Button size="sm" onClick={recheck} disabled={busy}>
        <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} /> Re-check
      </Button>
    </div>
  );
}
