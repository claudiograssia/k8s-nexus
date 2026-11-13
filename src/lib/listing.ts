// Namespace-aware fetching for users with narrow permissions.
//
// "All namespaces" means one cluster-wide call — which RBAC often denies to
// users who can only read a few namespaces. When that call is forbidden we
// fall back to one call per namespace the UI knows about (listed, typed in by
// the user, or the kubeconfig default) and remember which scopes were denied
// so polling does not keep hitting them.

import { api } from "./api";
import { isAppError, type AppError, type GvkSpec, type KubeObject } from "./types";
import { useAppStore } from "@/store/useAppStore";

/** The part of a tab that decides which namespaces to query. */
export interface NamespaceSelection {
  namespaceMode: "all" | "single" | "multi";
  namespaces: string[];
}

/** Identifies what is being fetched, for remembering denied scopes. */
export interface ScopedKind {
  id: string;
  namespaced: boolean;
}

export const kindOf = (spec: GvkSpec): ScopedKind => ({
  id: `${spec.group}/${spec.plural}`,
  namespaced: spec.namespaced,
});

/** Namespaces usable without listing them: listed ∪ typed-in ∪ kubeconfig default. */
export function knownNamespaces(context: string): string[] {
  const s = useAppStore.getState();
  const set = new Set([
    ...(s.namespacesByContext[context] ?? []),
    ...(s.manualNamespaces[context] ?? []),
  ]);
  const fallback = s.contextByName(context)?.namespace;
  if (fallback) set.add(fallback);
  return [...set].sort();
}

/** Scopes for a selection: `[""]` is cluster-wide, otherwise one per namespace. */
export function targetNamespaces(sel: NamespaceSelection, kind: ScopedKind): string[] {
  if (!kind.namespaced || sel.namespaceMode === "all" || sel.namespaces.length === 0) return [""];
  return sel.namespaces;
}

// Denied scopes are retried after a while: permissions can be granted later.
const FORBIDDEN_TTL_MS = 5 * 60_000;
const forbiddenAt = new Map<string, number>();
const scopeKey = (context: string, kind: ScopedKind, ns: string) => `${context}|${kind.id}|${ns}`;

export function isForbidden(context: string, kind: ScopedKind, ns: string): boolean {
  const at = forbiddenAt.get(scopeKey(context, kind, ns));
  return at !== undefined && Date.now() - at < FORBIDDEN_TTL_MS;
}

export function markForbidden(context: string, kind: ScopedKind, ns: string) {
  forbiddenAt.set(scopeKey(context, kind, ns), Date.now());
}

/** Forget denied scopes of a context (manual refresh). */
export function forgetForbidden(context: string) {
  for (const k of forbiddenAt.keys()) if (k.startsWith(`${context}|`)) forbiddenAt.delete(k);
}

/** Per-namespace scopes to try once the cluster-wide call is denied. */
export function fallbackNamespaces(context: string, kind: ScopedKind): string[] {
  return knownNamespaces(context).filter((ns) => !isForbidden(context, kind, ns));
}

/** Error raised when nothing can be listed until the user adds a namespace. */
export interface NeedsNamespaceError extends AppError {
  needsNamespace: true;
}

export function needsNamespaceError(label: string): NeedsNamespaceError {
  return {
    kind: "forbidden",
    message: `You are not allowed to list ${label} across all namespaces. Add a namespace you have access to.`,
    needsNamespace: true,
  };
}

export function isNeedsNamespace(e: unknown): e is NeedsNamespaceError {
  return isAppError(e) && (e as Partial<NeedsNamespaceError>).needsNamespace === true;
}

const isForbiddenError = (e: unknown) => isAppError(e) && e.kind === "forbidden";

/**
 * Run `fetcher` for every scope of the selection (null = cluster-wide) and
 * merge the results. Scopes the user may not read are skipped; it throws only
 * when no scope could be read.
 */
export async function fetchScoped<T>(
  context: string,
  sel: NamespaceSelection,
  kind: ScopedKind,
  label: string,
  fetcher: (namespace: string | null) => Promise<T[]>,
): Promise<T[]> {
  let targets = targetNamespaces(sel, kind);
  let clusterWide = targets.length === 1 && targets[0] === "";
  let usingFallback = false;

  if (clusterWide && kind.namespaced && isForbidden(context, kind, "")) {
    targets = fallbackNamespaces(context, kind);
    if (targets.length === 0) throw needsNamespaceError(label);
    clusterWide = false;
    usingFallback = true;
  }

  const results = await Promise.allSettled(targets.map((ns) => fetcher(ns || null)));
  const out: T[] = [];
  let firstError: unknown = null;
  let allForbidden = true;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      out.push(...r.value);
      allForbidden = false;
      return;
    }
    if (isForbiddenError(r.reason)) markForbidden(context, kind, targets[i]);
    else allForbidden = false;
    firstError ??= r.reason;
  });

  if (results.some((r) => r.status === "fulfilled")) return out;

  if (allForbidden && kind.namespaced) {
    if (usingFallback) throw needsNamespaceError(label);
    // Cluster-wide denied: retry once per known namespace.
    if (clusterWide) {
      const fallback = fallbackNamespaces(context, kind);
      if (fallback.length === 0) throw needsNamespaceError(label);
      return fetchScoped(context, sel, kind, label, fetcher);
    }
  }
  throw firstError;
}

/** `listResources` across the tab's namespace selection, with the fallback above. */
export function listScoped(
  context: string,
  sel: NamespaceSelection,
  spec: GvkSpec,
  labelSelector?: string | null,
  fieldSelector?: string | null,
): Promise<KubeObject[]> {
  return fetchScoped(context, sel, kindOf(spec), spec.plural, (ns) =>
    api.listResources(context, spec, ns, labelSelector, fieldSelector),
  );
}
