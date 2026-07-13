import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KubeObject } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compact human age from an ISO timestamp, e.g. `5d`, `3h`, `12m`, `9s`. */
export function formatAge(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  let secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const d = Math.floor(secs / 86400);
  if (d > 0) {
    const h = Math.floor((secs % 86400) / 3600);
    return h > 0 && d < 10 ? `${d}d${h}h` : `${d}d`;
  }
  const h = Math.floor(secs / 3600);
  if (h > 0) {
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 && h < 10 ? `${h}h${m}m` : `${h}h`;
  }
  const m = Math.floor(secs / 60);
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

/** Format bytes into a binary-suffixed string (Ki/Mi/Gi …). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0";
  const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)}${units[i]}`;
}

/** Format millicores into `m` or cores. */
export function formatCpu(milli: number): string {
  if (!milli || milli <= 0) return "0";
  if (milli < 1000) return `${Math.round(milli)}m`;
  return `${(milli / 1000).toFixed(2)}`;
}

export function get(obj: KubeObject, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as object)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
}

export function getString(obj: KubeObject, path: string, fallback = "—"): string {
  const v = get(obj, path);
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export function objName(o: KubeObject): string {
  return o.metadata?.name ?? "—";
}

export function objNamespace(o: KubeObject): string | undefined {
  return o.metadata?.namespace;
}

/** A stable string key for a resource item. */
export function objKey(o: KubeObject): string {
  return `${o.metadata?.namespace ?? "-"}/${o.metadata?.name ?? "-"}`;
}

/** Deterministic vivid color for a string (used to color pods in log view). */
export function colorForString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 62%)`;
}

export function base64Decode(v: string): string {
  try {
    // atob handles standard base64; decode to UTF-8.
    const binary = atob(v);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return v;
  }
}

export function base64Encode(v: string): string {
  const bytes = new TextEncoder().encode(v);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
