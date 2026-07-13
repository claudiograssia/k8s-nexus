import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-muted-foreground", className)} />;
}

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
