import { Radio } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";

/** Green when the list is kept live by a watch, grey when it is polled. */
export function LiveIndicator({ mode, pollMs = 8000 }: { mode: "watch" | "poll"; pollMs?: number }) {
  return (
    <Hint
      label={
        mode === "watch"
          ? "Live: changes are pushed by the cluster"
          : `Polling every ${Math.round(pollMs / 1000)}s (watch not permitted)`
      }
    >
      <Radio
        className={mode === "watch" ? "size-3.5 text-[hsl(var(--ok))]" : "size-3.5 text-muted-foreground"}
      />
    </Hint>
  );
}
