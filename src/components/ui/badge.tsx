import * as React from "react";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "@/lib/catalog";

const toneClass: Record<BadgeTone, string> = {
  ok: "badge-ok",
  warn: "badge-warn",
  err: "badge-err",
  info: "badge-info",
  muted: "badge-muted",
};

export function Badge({
  tone = "muted",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn("badge", toneClass[tone], className)}>{children}</span>;
}
