import { KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/common/CopyButton";
import { MetaBlock } from "./parts";
import type { KubeObject } from "@/lib/types";

export function ServiceAccountDetail({ obj }: { obj: KubeObject }) {
  const gsa = obj.metadata?.annotations?.["iam.gke.io/gcp-service-account"];
  const secrets = (obj.secrets as Array<{ name?: string }>) ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-3.5" /> GKE Workload Identity
        </p>
        {gsa ? (
          <div className="flex items-center gap-2">
            <Badge tone="info">
              <KeyRound className="size-3" /> Bound
            </Badge>
            <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">{gsa}</span>
            <CopyButton value={gsa} />
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No <span className="font-mono">iam.gke.io/gcp-service-account</span> annotation — this
            ServiceAccount is not bound to a Google Cloud IAM identity.
          </p>
        )}
      </div>

      {secrets.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Secrets ({secrets.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {secrets.map((s) => (
              <span key={s.name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <MetaBlock obj={obj} />
    </div>
  );
}
