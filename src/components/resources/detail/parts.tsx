import type { ReactNode } from "react";
import type { KubeObject } from "@/lib/types";
import { formatAge } from "@/lib/utils";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5 text-[12px]">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all font-mono text-foreground/90">{children}</span>
    </div>
  );
}

export function Chips({ map }: { map?: Record<string, string> }) {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return <span className="text-[12px] text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          title={`${k}=${v}`}
        >
          {k}={v.length > 40 ? v.slice(0, 39) + "…" : v}
        </span>
      ))}
    </div>
  );
}

export function MetaBlock({ obj }: { obj: KubeObject }) {
  const m = obj.metadata ?? {};
  return (
    <div className="space-y-2">
      <div>
        <Field label="Name">{m.name ?? "—"}</Field>
        {m.namespace && <Field label="Namespace">{m.namespace}</Field>}
        <Field label="Created">
          {m.creationTimestamp ? `${m.creationTimestamp} (${formatAge(m.creationTimestamp)})` : "—"}
        </Field>
        {m.uid && <Field label="UID">{m.uid}</Field>}
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Labels
        </p>
        <Chips map={m.labels} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Annotations
        </p>
        <Chips map={m.annotations} />
      </div>
    </div>
  );
}
