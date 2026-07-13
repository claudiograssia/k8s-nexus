import { useState } from "react";
import { Eye, EyeOff, Binary, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/common/CopyButton";
import { base64Decode } from "@/lib/utils";
import type { KubeObject } from "@/lib/types";

export function SecretDetail({ obj }: { obj: KubeObject }) {
  const data = (obj.data ?? {}) as Record<string, unknown>;
  const entries = Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : ""] as const);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [decoded, setDecoded] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Data ({entries.length} keys)
        </p>
        <span className="text-[10px] text-[hsl(var(--warn))]">values base64-encoded on the cluster</span>
      </div>
      {entries.length === 0 && <p className="text-[12px] text-muted-foreground">No data keys.</p>}
      {entries.map(([key, raw]) => {
        const isRevealed = revealed[key];
        const isDecoded = decoded[key];
        const shown = isDecoded ? base64Decode(raw) : raw;
        const display = isRevealed ? shown : "•".repeat(Math.min(32, shown.length || 8));
        return (
          <div key={key} className="rounded-md border border-border bg-background/50">
            <div className="flex items-center gap-2 border-b border-border px-2 py-1">
              <span className="font-mono text-[12px] text-primary">{key}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setDecoded((d) => ({ ...d, [key]: !d[key] }))}
                  title="Toggle Base64 decode/encode"
                >
                  {isDecoded ? <Type /> : <Binary />}
                  {isDecoded ? "Decoded" : "Base64"}
                </Button>
                <Button
                  size="iconSm"
                  variant="ghost"
                  onClick={() => setRevealed((r) => ({ ...r, [key]: !r[key] }))}
                  title={isRevealed ? "Hide" : "Reveal"}
                >
                  {isRevealed ? <EyeOff /> : <Eye />}
                </Button>
                <CopyButton value={shown} />
              </div>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] text-foreground/90">
              {display}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
