import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import {
  isAppError,
  type AccessCheck,
  type ContextInfo,
  type ExecTarget,
  type KubeconfigSummary,
  type LogTarget,
  type ToolStatus,
} from "@/lib/types";

export type TabView =
  | "dashboard"
  | "resources"
  | "finops"
  | "networking"
  | "iam";

export type NamespaceMode = "all" | "single" | "multi";

export interface ClusterTab {
  id: string;
  context: string;
  title: string;
  view: TabView;
  /** Active resource catalog id when `view === "resources"`. */
  resourceId: string;
  /** Selected namespaces; empty means "all namespaces". */
  namespaces: string[];
  namespaceMode: NamespaceMode;
}

export interface Favorite {
  id: string;
  kind: "cluster" | "resource" | "namespace";
  context: string;
  label: string;
  resourceId?: string;
  namespace?: string;
}

export interface Toast {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
}

export interface GkeAuthPrompt {
  context: string;
  message: string;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

/** Polling views hit the same failure every few seconds: toast it once a minute at most. */
const ERROR_REPEAT_MS = 60_000;
const lastErrorAt = new Map<string, number>();
const MAX_TOASTS = 4;

/** Cache key of one permission check. */
export function accessKey(context: string, c: AccessCheck): string {
  return [context, c.verb, c.group, c.resource, c.subresource ?? "", c.namespace ?? ""].join("|");
}
const accessInFlight = new Set<string>();

interface AppState {
  // Startup
  init: () => Promise<void>;

  // Contexts
  summary: KubeconfigSummary | null;
  contextsLoading: boolean;
  loadContexts: () => Promise<void>;
  contextByName: (name: string) => ContextInfo | undefined;

  // External tools + kubeconfig path
  tools: ToolStatus | null;
  loadTools: () => Promise<void>;
  kubeconfigPath: string;
  applyKubeconfigPath: (path: string) => Promise<void>;

  // Namespace cache per context
  namespacesByContext: Record<string, string[]>;
  /** Contexts where listing namespaces is forbidden: the user adds them by hand. */
  namespacesForbidden: Record<string, boolean>;
  loadNamespaces: (context: string) => Promise<void>;
  /** Namespaces typed in by the user, per context (persisted). */
  manualNamespaces: Record<string, string[]>;
  addManualNamespace: (context: string, namespace: string) => void;
  removeManualNamespace: (context: string, namespace: string) => void;

  // Permissions: SelfSubjectAccessReview answers keyed by `accessKey`.
  // null = could not be determined (treated as allowed).
  access: Record<string, boolean | null>;
  ensureAccess: (context: string, checks: AccessCheck[]) => Promise<void>;

  // Tabs
  tabs: ClusterTab[];
  activeTabId: string | null;
  openTab: (
    context: string,
    opts?: { view?: TabView; resourceId?: string; namespace?: string },
  ) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<ClusterTab>) => void;
  activeTab: () => ClusterTab | undefined;

  // Favorites
  favorites: Favorite[];
  addFavorite: (fav: Omit<Favorite, "id">) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (predicate: Partial<Favorite>) => boolean;

  // Bottom docked panels (mutually exclusive): terminal, logs, port-forwards
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean) => void;
  /** When set, the terminal runs a pod exec/attach instead of a cluster shell. */
  execTarget: ExecTarget | null;
  openExecTerminal: (target: ExecTarget) => void;
  logTarget: LogTarget | null;
  openLogs: (target: LogTarget) => void;
  closeLogs: () => void;
  portForwardOpen: boolean;
  setPortForwardOpen: (v: boolean) => void;

  // Safe mode
  safeContexts: string[];
  loadSafeContexts: () => Promise<void>;
  toggleSafeMode: (context: string) => Promise<void>;
  isSafe: (context: string) => boolean;

  // Toasts + GKE auth healing
  toasts: Toast[];
  pushToast: (tone: Toast["tone"], message: string) => void;
  dismissToast: (id: string) => void;
  gkeAuthPrompt: GkeAuthPrompt | null;
  setGkeAuthPrompt: (p: GkeAuthPrompt | null) => void;
  /** `silent` skips the toast (for views that show the error inline). */
  reportError: (e: unknown, context?: string, opts?: { silent?: boolean }) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      async init() {
        const path = get().kubeconfigPath?.trim();
        if (path) {
          try {
            await api.setKubeconfigPath(path);
          } catch {
            /* fall through to default kubeconfig */
          }
        }
        await get().loadContexts();
        void get().loadSafeContexts();
        void get().loadTools();
      },

      summary: null,
      contextsLoading: false,
      async loadContexts() {
        set({ contextsLoading: true });
        try {
          const summary = await api.listContexts();
          set({ summary, contextsLoading: false });
        } catch (e) {
          set({ contextsLoading: false });
          get().reportError(e);
        }
      },
      contextByName(name) {
        return get().summary?.contexts.find((c) => c.name === name);
      },

      tools: null,
      async loadTools() {
        try {
          set({ tools: await api.checkTools() });
        } catch {
          /* ignore */
        }
      },
      kubeconfigPath: "",
      async applyKubeconfigPath(path) {
        const trimmed = path.trim();
        try {
          const summary = await api.setKubeconfigPath(trimmed || null);
          // Contexts changed: close open tabs and drop cached namespaces.
          set({
            kubeconfigPath: trimmed,
            summary,
            tabs: [],
            activeTabId: null,
            namespacesByContext: {},
          });
          get().pushToast(
            "success",
            trimmed ? `Kubeconfig: ${trimmed}` : "Kubeconfig reset to default",
          );
        } catch (e) {
          get().reportError(e);
        }
      },

      namespacesByContext: {},
      namespacesForbidden: {},
      async loadNamespaces(context) {
        try {
          const items = await api.listResources(context, {
            group: "",
            version: "v1",
            kind: "Namespace",
            plural: "namespaces",
            namespaced: false,
          });
          const names = items
            .map((i) => i.metadata?.name ?? "")
            .filter(Boolean)
            .sort();
          set((s) => ({
            namespacesByContext: { ...s.namespacesByContext, [context]: names },
            namespacesForbidden: { ...s.namespacesForbidden, [context]: false },
          }));
        } catch (e) {
          if (isAppError(e) && e.kind === "forbidden") {
            set((s) => ({ namespacesForbidden: { ...s.namespacesForbidden, [context]: true } }));
            return;
          }
          // Silent: this is a background load with its own retry. On an auth
          // failure (e.g. expired GKE token at cold start) drop the cached
          // client so the next attempt rebuilds with fresh credentials.
          if (isAppError(e) && (e.kind === "auth" || e.kind === "gkeAuth")) {
            void api.invalidateClient(context);
          }
        }
      },

      manualNamespaces: {},
      addManualNamespace(context, namespace) {
        const ns = namespace.trim();
        if (!ns) return;
        set((s) => {
          const current = s.manualNamespaces[context] ?? [];
          if (current.includes(ns)) return {};
          return { manualNamespaces: { ...s.manualNamespaces, [context]: [...current, ns].sort() } };
        });
      },
      removeManualNamespace(context, namespace) {
        set((s) => ({
          manualNamespaces: {
            ...s.manualNamespaces,
            [context]: (s.manualNamespaces[context] ?? []).filter((n) => n !== namespace),
          },
        }));
      },

      access: {},
      async ensureAccess(context, checks) {
        const known = get().access;
        const missing = checks.filter((c) => {
          const key = accessKey(context, c);
          return !(key in known) && !accessInFlight.has(key);
        });
        if (missing.length === 0) return;
        const keys = missing.map((c) => accessKey(context, c));
        keys.forEach((k) => accessInFlight.add(k));
        let answers: (boolean | null)[] = [];
        try {
          answers = await api.checkAccess(context, missing);
        } catch {
          /* unreachable cluster: leave unknown (allowed), the real call will report */
        } finally {
          keys.forEach((k) => accessInFlight.delete(k));
        }
        set((s) => {
          const access = { ...s.access };
          keys.forEach((k, i) => (access[k] = answers[i] ?? null));
          return { access };
        });
      },

      tabs: [],
      activeTabId: null,
      openTab(context, opts) {
        const id = uid("tab");
        const tab: ClusterTab = {
          id,
          context,
          title: shortClusterName(context),
          view: opts?.view ?? "dashboard",
          resourceId: opts?.resourceId ?? "pods",
          namespaces: opts?.namespace ? [opts.namespace] : [],
          namespaceMode: opts?.namespace ? "single" : "all",
        };
        // Opening a tab re-asks permissions for that cluster (they may have changed).
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: id,
          access: Object.fromEntries(
            Object.entries(s.access).filter(([k]) => !k.startsWith(`${context}|`)),
          ),
        }));
        void get().loadNamespaces(context);
      },
      closeTab(id) {
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          let activeTabId = s.activeTabId;
          if (activeTabId === id) {
            activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
          }
          return { tabs, activeTabId };
        });
      },
      setActiveTab(id) {
        set({ activeTabId: id });
      },
      updateTab(id, patch) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
      },
      activeTab() {
        const s = get();
        return s.tabs.find((t) => t.id === s.activeTabId);
      },

      favorites: [],
      addFavorite(fav) {
        set((s) => ({ favorites: [...s.favorites, { ...fav, id: uid("fav") }] }));
      },
      removeFavorite(id) {
        set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }));
      },
      isFavorite(predicate) {
        return get().favorites.some((f) =>
          Object.entries(predicate).every(
            ([k, v]) => (f as unknown as Record<string, unknown>)[k] === v,
          ),
        );
      },

      terminalOpen: false,
      setTerminalOpen(v) {
        // Opening the cluster shell clears any exec target and other panels.
        set(
          v
            ? { terminalOpen: true, execTarget: null, logTarget: null, portForwardOpen: false }
            : { terminalOpen: false },
        );
      },
      execTarget: null,
      openExecTerminal(target) {
        set({
          execTarget: target,
          terminalOpen: true,
          logTarget: null,
          portForwardOpen: false,
        });
      },
      logTarget: null,
      openLogs(target) {
        set({ logTarget: target, terminalOpen: false, portForwardOpen: false });
      },
      closeLogs() {
        set({ logTarget: null });
      },
      portForwardOpen: false,
      setPortForwardOpen(v) {
        set(v ? { portForwardOpen: true, terminalOpen: false, logTarget: null } : { portForwardOpen: false });
      },

      safeContexts: [],
      async loadSafeContexts() {
        try {
          const list = await api.getSafeContexts();
          set({ safeContexts: list });
        } catch (e) {
          get().reportError(e);
        }
      },
      async toggleSafeMode(context) {
        const enabled = !get().isSafe(context);
        try {
          await api.setSafeMode(context, enabled);
          set((s) => ({
            safeContexts: enabled
              ? [...s.safeContexts, context]
              : s.safeContexts.filter((c) => c !== context),
          }));
          get().pushToast(
            "info",
            enabled
              ? `Safe Mode ON for ${shortClusterName(context)} — writes disabled`
              : `Safe Mode OFF for ${shortClusterName(context)}`,
          );
        } catch (e) {
          get().reportError(e, context);
        }
      },
      isSafe(context) {
        return get().safeContexts.includes(context);
      },

      toasts: [],
      pushToast(tone, message) {
        if (get().toasts.some((t) => t.tone === tone && t.message === message)) return;
        const id = uid("toast");
        set((s) => ({ toasts: [...s.toasts, { id, tone, message }].slice(-MAX_TOASTS) }));
        setTimeout(() => get().dismissToast(id), tone === "error" ? 10_000 : 6000);
      },
      dismissToast(id) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      gkeAuthPrompt: null,
      setGkeAuthPrompt(p) {
        set({ gkeAuthPrompt: p });
      },
      reportError(e, context, opts) {
        const message = isAppError(e) ? e.message : String(e);
        if (isAppError(e)) {
          // Drop the cached (possibly stale) client so polling self-heals.
          if (context && (e.kind === "auth" || e.kind === "gkeAuth")) {
            void api.invalidateClient(context);
          }
          if (e.kind === "gkeAuth" && context) {
            set({ gkeAuthPrompt: { context, message: e.message } });
          }
        }
        if (opts?.silent) return;
        const key = `${context ?? ""}|${message}`;
        const now = Date.now();
        if (now - (lastErrorAt.get(key) ?? 0) < ERROR_REPEAT_MS) return;
        lastErrorAt.set(key, now);
        get().pushToast("error", message);
      },
    }),
    {
      name: "kubenexus-store",
      // Only persist the user's saved preferences, not live cluster data.
      partialize: (s) =>
        ({
          favorites: s.favorites,
          kubeconfigPath: s.kubeconfigPath,
          manualNamespaces: s.manualNamespaces,
        }) as AppState,
    },
  ),
);

/** `gke_project_region_cluster` -> `cluster`. */
export function shortClusterName(context: string): string {
  if (context.startsWith("gke_")) {
    const parts = context.split("_");
    return parts[parts.length - 1] || context;
  }
  return context;
}
