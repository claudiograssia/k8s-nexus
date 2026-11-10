import * as React from "react";
import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type Toast } from "@/store/useAppStore";

const icons = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
};

const tones = {
  info: "border-[hsl(var(--info)/0.4)] text-[hsl(var(--info))]",
  success: "border-[hsl(var(--ok)/0.4)] text-[hsl(var(--ok))]",
  error: "border-[hsl(var(--err)/0.4)] text-[hsl(var(--err))]",
};

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[100] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

/** Long messages are clamped; click the text to expand. */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const Icon = icons[toast.tone];
  const long = toast.message.length > 180;
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-md border bg-card/95 p-3 shadow-lg backdrop-blur animate-slide-up",
        tones[toast.tone],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p
        onClick={long ? () => setExpanded((v) => !v) : undefined}
        title={long && !expanded ? "Click to expand" : undefined}
        className={cn(
          "min-w-0 flex-1 select-text whitespace-pre-line break-words text-[12px] text-foreground",
          long && "cursor-pointer",
          long && !expanded && "line-clamp-4",
        )}
      >
        {toast.message}
      </p>
      <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
