import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

/** Warns when the external CLIs the app depends on are missing on this machine. */
export function ToolsBanner() {
  const tools = useAppStore((s) => s.tools);
  const [dismissed, setDismissed] = useState(false);

  if (!tools || dismissed) return null;

  const missing: { name: string; hint: string }[] = [];
  if (!tools.kubectl)
    missing.push({ name: "kubectl", hint: "required to talk to clusters — install the Kubernetes CLI" });
  if (!tools.gcloud)
    missing.push({ name: "gcloud", hint: "required for GKE — install the Google Cloud SDK" });
  if (tools.gcloud && !tools.gkeAuthPlugin)
    missing.push({
      name: "gke-gcloud-auth-plugin",
      hint: "needed for GKE auth — run: gcloud components install gke-gcloud-auth-plugin",
    });

  if (missing.length === 0) return null;

  return (
    <div className="flex items-start gap-3 border-b border-[hsl(var(--err)/0.4)] bg-[hsl(var(--err)/0.12)] px-4 py-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[hsl(var(--err))]" />
      <div className="min-w-0 flex-1 text-[12px]">
        <p className="font-medium text-foreground">
          Missing required tools on this machine
        </p>
        <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
          {missing.map((m) => (
            <li key={m.name}>
              <span className="font-mono text-[hsl(var(--err))]">{m.name}</span> — {m.hint}
            </li>
          ))}
        </ul>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground"
        title="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
