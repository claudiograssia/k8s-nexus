import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

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
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-md border bg-card/95 p-3 shadow-lg backdrop-blur animate-slide-up",
              tones[t.tone],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1 break-words text-[12px] text-foreground">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
