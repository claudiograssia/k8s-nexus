import { CopyButton } from "@/components/common/CopyButton";
import type { KubeObject } from "@/lib/types";

export function ConfigMapDetail({ obj }: { obj: KubeObject }) {
  const data = (obj.data ?? {}) as Record<string, unknown>;
  const entries = Object.entries(data);

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Data ({entries.length} keys)
      </p>
      {entries.length === 0 && (
        <p className="text-[12px] text-muted-foreground">No data keys.</p>
      )}
      {entries.map(([key, val]) => {
        const value = typeof val === "string" ? val : JSON.stringify(val, null, 2);
        return (
          <div key={key} className="rounded-md border border-border bg-background/50">
            <div className="flex items-center gap-2 border-b border-border px-2 py-1">
              <span className="font-mono text-[12px] text-primary">{key}</span>
              <span className="text-[10px] text-muted-foreground">{value.length} chars</span>
              <CopyButton value={value} className="ml-auto" />
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
              {value}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
