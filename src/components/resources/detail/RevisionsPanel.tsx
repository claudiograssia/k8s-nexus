import { useCallback, useEffect, useState } from "react";
import { CenteredSpinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatAge } from "@/lib/utils";
import type { KubeObject } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

const RS_GVK = {
  group: "apps",
  version: "v1",
  kind: "ReplicaSet",
  plural: "replicasets",
  namespaced: true,
};

interface Revision {
  key: string;
  revision: number;
  name: string;
  images: string;
  desired: number;
  ready: number;
  created?: string;
  changeCause?: string;
}

function toRevision(rs: KubeObject): Revision {
  const ann = rs.metadata?.annotations ?? {};
  const spec = (rs.spec ?? {}) as Record<string, unknown>;
  const status = (rs.status ?? {}) as Record<string, unknown>;
  const template = spec.template as Record<string, unknown> | undefined;
  const tspec = template?.spec as Record<string, unknown> | undefined;
  const containers = (tspec?.containers as Array<{ image?: string }>) ?? [];
  return {
    key: rs.metadata?.uid ?? rs.metadata?.name ?? Math.random().toString(),
    revision: Number(ann["deployment.kubernetes.io/revision"] ?? 0),
    name: rs.metadata?.name ?? "—",
    images: containers.map((c) => c.image).filter(Boolean).join(", ") || "—",
    desired: typeof spec.replicas === "number" ? spec.replicas : 0,
    ready: typeof status.readyReplicas === "number" ? (status.readyReplicas as number) : 0,
    created: rs.metadata?.creationTimestamp,
    changeCause: ann["kubernetes.io/change-cause"],
  };
}

export function RevisionsPanel({
  context,
  obj,
  namespace,
}: {
  context: string;
  obj: KubeObject;
  namespace: string | null;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const reportError = useAppStore((s) => s.reportError);

  const deploymentName = obj.metadata?.name;
  const deploymentUid = obj.metadata?.uid;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.listResources(context, RS_GVK, namespace);
      const owned = all.filter((rs) => {
        const owners = (rs.metadata?.ownerReferences ?? []) as Array<{
          kind: string;
          name: string;
          uid?: string;
        }>;
        return owners.some(
          (o) =>
            o.kind === "Deployment" &&
            (deploymentUid ? o.uid === deploymentUid : o.name === deploymentName),
        );
      });
      const revs = owned.map(toRevision).sort((a, b) => b.revision - a.revision);
      setRevisions(revs);
    } catch (e) {
      reportError(e, context);
    } finally {
      setLoading(false);
    }
  }, [context, namespace, deploymentName, deploymentUid, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <CenteredSpinner label="Loading revisions…" />;

  if (revisions.length === 0) {
    return <p className="p-4 text-[12px] text-muted-foreground">No revision history found.</p>;
  }

  return (
    <div className="space-y-2 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Rollout history ({revisions.length})
      </p>
      {revisions.map((r, i) => (
        <div key={r.key} className="rounded-md border border-border bg-background/40 p-2">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={i === 0 ? "ok" : "muted"}>rev {r.revision}</Badge>
            {i === 0 && <span className="text-[10px] text-[hsl(var(--ok))]">current</span>}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {r.ready}/{r.desired} pods · {formatAge(r.created)}
            </span>
          </div>
          <p className="break-all font-mono text-[11px] text-foreground/85">{r.images}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{r.name}</p>
          {r.changeCause && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">cause: {r.changeCause}</p>
          )}
        </div>
      ))}
    </div>
  );
}
