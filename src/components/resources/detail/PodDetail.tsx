import { AlertTriangle, ShieldAlert, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, MetaBlock } from "./parts";
import type { KubeObject } from "@/lib/types";

interface Container {
  name?: string;
  image?: string;
  securityContext?: {
    privileged?: boolean;
    runAsNonRoot?: boolean;
    runAsUser?: number;
    allowPrivilegeEscalation?: boolean;
    capabilities?: { add?: string[] };
  };
  resources?: { limits?: Record<string, string>; requests?: Record<string, string> };
}

interface ContainerStatus {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  image?: string;
  state?: Record<string, { reason?: string; message?: string }>;
}

/** Security Linter findings for a single pod. */
function lint(pod: KubeObject): { tone: "err" | "warn"; text: string }[] {
  const spec = (pod.spec ?? {}) as Record<string, unknown>;
  const containers = (spec.containers as Container[]) ?? [];
  const podSc = (spec.securityContext as Container["securityContext"]) ?? {};
  const findings: { tone: "err" | "warn"; text: string }[] = [];

  if (containers.some((c) => c.securityContext?.privileged)) {
    findings.push({ tone: "err", text: "privileged: true" });
  }
  if (containers.some((c) => c.securityContext?.allowPrivilegeEscalation)) {
    findings.push({ tone: "warn", text: "allowPrivilegeEscalation" });
  }
  const runAsNonRoot =
    podSc.runAsNonRoot === true || containers.some((c) => c.securityContext?.runAsNonRoot === true);
  if (!runAsNonRoot) {
    findings.push({ tone: "warn", text: "may run as root" });
  }
  if (containers.some((c) => !c.resources?.limits || Object.keys(c.resources.limits).length === 0)) {
    findings.push({ tone: "warn", text: "missing resource limits" });
  }
  if (
    containers.some((c) => (c.securityContext?.capabilities?.add ?? []).some((cap) => cap === "ALL" || cap === "SYS_ADMIN"))
  ) {
    findings.push({ tone: "err", text: "dangerous capabilities" });
  }
  if (spec.hostNetwork === true) findings.push({ tone: "warn", text: "hostNetwork" });
  if (spec.hostPID === true) findings.push({ tone: "warn", text: "hostPID" });
  return findings;
}

export function PodDetail({ obj }: { obj: KubeObject }) {
  const spec = (obj.spec ?? {}) as Record<string, unknown>;
  const status = (obj.status ?? {}) as Record<string, unknown>;
  const containers = (spec.containers as Container[]) ?? [];
  const statuses = (status.containerStatuses as ContainerStatus[]) ?? [];
  const findings = lint(obj);

  const stateOf = (name?: string) => {
    const cs = statuses.find((s) => s.name === name);
    if (!cs?.state) return "—";
    const key = Object.keys(cs.state)[0];
    const reason = key ? cs.state[key]?.reason : undefined;
    return reason ? `${key} (${reason})` : (key ?? "—");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={String(status.phase) === "Running" ? "ok" : "warn"}>
          {String(status.phase ?? "Unknown")}
        </Badge>
        {findings.length === 0 ? (
          <Badge tone="ok">
            <ShieldAlert className="size-3" /> No security findings
          </Badge>
        ) : (
          findings.map((f, i) => (
            <Badge key={i} tone={f.tone}>
              <AlertTriangle className="size-3" /> {f.text}
            </Badge>
          ))
        )}
      </div>

      <div className="rounded-md border border-border p-2">
        <Field label="Node">{String(spec.nodeName ?? "—")}</Field>
        <Field label="Pod IP">{String(status.podIP ?? "—")}</Field>
        <Field label="Host IP">{String(status.hostIP ?? "—")}</Field>
        <Field label="QoS Class">{String(status.qosClass ?? "—")}</Field>
        <Field label="Service Account">{String(spec.serviceAccountName ?? spec.serviceAccount ?? "default")}</Field>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Boxes className="size-3.5" /> Containers ({containers.length})
        </p>
        <div className="space-y-1">
          {containers.map((c) => {
            const cs = statuses.find((s) => s.name === c.name);
            return (
              <div key={c.name} className="rounded-md border border-border bg-background/50 p-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-primary">{c.name}</span>
                  <Badge tone={cs?.ready ? "ok" : "warn"}>{cs?.ready ? "ready" : "not ready"}</Badge>
                  <span className="text-[11px] text-muted-foreground">restarts: {cs?.restartCount ?? 0}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{stateOf(c.name)}</span>
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-foreground/80">{c.image}</p>
                <div className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
                  <span>
                    req: cpu {c.resources?.requests?.cpu ?? "—"} / mem {c.resources?.requests?.memory ?? "—"}
                  </span>
                  <span>
                    lim: cpu {c.resources?.limits?.cpu ?? "—"} / mem {c.resources?.limits?.memory ?? "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <MetaBlock obj={obj} />
    </div>
  );
}
