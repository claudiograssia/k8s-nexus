import type { ClusterTab } from "@/store/useAppStore";

export interface NamespaceScope {
  /** Namespace to pass to the backend list call (null = all namespaces). */
  queryNamespace: string | null;
  /** Client-side predicate to apply for multi-namespace selections. */
  matches: (ns?: string) => boolean;
}

export function namespaceScope(tab: ClusterTab): NamespaceScope {
  if (tab.namespaceMode === "all" || tab.namespaces.length === 0) {
    return { queryNamespace: null, matches: () => true };
  }
  if (tab.namespaceMode === "single") {
    const only = tab.namespaces[0];
    return { queryNamespace: only, matches: (ns) => ns === only };
  }
  // Multi: fetch all, filter to the selected set client-side.
  const set = new Set(tab.namespaces);
  return { queryNamespace: null, matches: (ns) => !!ns && set.has(ns) };
}
