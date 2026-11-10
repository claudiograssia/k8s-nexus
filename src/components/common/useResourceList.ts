import { useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import {
  fallbackNamespaces,
  forgetForbidden,
  isForbidden,
  kindOf,
  listScoped,
  markForbidden,
  needsNamespaceError,
  targetNamespaces,
  type NamespaceSelection,
} from "@/lib/listing";
import type { AppError, GvkSpec, KubeObject, WatchBatch, WatchDelta } from "@/lib/types";
import { objKey } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

export interface ResourceListState {
  items: KubeObject[];
  loading: boolean;
  error: unknown;
  /** "watch" = live updates; "poll" = periodic list (watch not permitted). */
  mode: "watch" | "poll";
  /** Restart from scratch (forgets denied scopes). */
  refresh: () => void;
}

interface Options {
  context: string;
  spec: GvkSpec;
  selection: NamespaceSelection;
  labelSelector?: string | null;
  enabled?: boolean;
  /** Interval for the polling fallback. */
  pollMs?: number;
}

const EMPTY: string[] = [];
let counter = 0;

/**
 * Live list of a resource kind: LIST + WATCH through the backend, falling back
 * to one watcher per namespace when the cluster-wide list is forbidden, and to
 * polling when the `watch` verb is not granted.
 */
export function useResourceList({
  context,
  spec,
  selection,
  labelSelector = null,
  enabled = true,
  pollMs = 8000,
}: Options): ResourceListState {
  const [items, setItems] = useState<KubeObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<"watch" | "poll">("watch");
  const [nonce, setNonce] = useState(0);

  // Restart when the namespaces usable for the fallback change.
  const manual = useAppStore((s) => s.manualNamespaces[context]) ?? EMPTY;
  const listedCount = useAppStore((s) => s.namespacesByContext[context]?.length ?? 0);

  const specKey = `${spec.group}/${spec.version}/${spec.plural}`;
  const selKey = `${selection.namespaceMode}:${selection.namespaces.join(",")}`;
  const manualKey = manual.join(",");

  useEffect(() => {
    if (!enabled) return;
    const kind = kindOf(spec);
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let watchId = "";
    let pollTimer: number | undefined;
    // Objects per watched scope ("" = cluster-wide).
    const scopes = new Map<string, Map<string, KubeObject>>();
    let targets: string[] = [];
    const denied = new Map<string, AppError>();
    const transient = new Map<string, AppError>();

    setLoading(true);
    setError(null);
    setItems([]);

    const stopWatch = () => {
      unlisten?.();
      unlisten = null;
      if (watchId) void api.stopWatch(watchId).catch(() => undefined);
      watchId = "";
    };

    const publish = () => {
      setItems([...scopes.values()].flatMap((m) => [...m.values()]));
      setLoading(false);
      if (targets.length > 0 && targets.every((t) => denied.has(t))) {
        setError(denied.get(targets[0]) ?? null);
      } else {
        setError(transient.values().next().value ?? null);
      }
    };

    const startPolling = () => {
      stopWatch();
      setMode("poll");
      const run = async () => {
        try {
          const list = await listScoped(context, selection, spec, labelSelector);
          if (disposed) return;
          setItems(list);
          setError(null);
        } catch (e) {
          if (!disposed) setError(e);
        } finally {
          if (!disposed) setLoading(false);
        }
      };
      void run();
      pollTimer = window.setInterval(() => void run(), pollMs);
    };

    const needsNamespace = () => {
      stopWatch();
      scopes.clear();
      setItems([]);
      setLoading(false);
      setError(needsNamespaceError(spec.plural));
    };

    const handle = (deltas: WatchDelta[]) => {
      let watchDenied = false;
      let clusterWideDenied = false;
      for (const d of deltas) {
        switch (d.type) {
          case "reset":
            scopes.set(d.scope, new Map(d.items.map((o) => [objKey(o), o])));
            transient.delete(d.scope);
            break;
          case "apply": {
            const m = scopes.get(d.scope) ?? new Map<string, KubeObject>();
            m.set(objKey(d.object), d.object);
            scopes.set(d.scope, m);
            transient.delete(d.scope);
            break;
          }
          case "delete":
            scopes.get(d.scope)?.delete(objKey(d.object));
            break;
          case "error":
            if (d.fatal && d.kind === "forbidden" && d.phase === "watch") {
              watchDenied = true;
            } else if (d.fatal) {
              if (d.kind === "forbidden") markForbidden(context, kind, d.scope);
              if (d.kind === "forbidden" && d.scope === "" && spec.namespaced) clusterWideDenied = true;
              scopes.delete(d.scope);
              denied.set(d.scope, { kind: d.kind, message: d.message });
            } else {
              transient.set(d.scope, { kind: d.kind, message: d.message });
            }
            break;
        }
      }

      if (watchDenied) return startPolling();
      if (clusterWideDenied) {
        const fallback = fallbackNamespaces(context, kind);
        return fallback.length > 0 ? void startWatch(fallback) : needsNamespace();
      }
      // Every per-namespace fallback scope denied: nothing left to show.
      if (selection.namespaceMode === "all" && targets[0] !== "" && targets.every((t) => denied.has(t))) {
        return needsNamespace();
      }
      publish();
    };

    const startWatch = async (scopeList: string[]) => {
      stopWatch();
      scopes.clear();
      denied.clear();
      transient.clear();
      targets = scopeList;
      setMode("watch");
      const id = `watch-${Date.now().toString(36)}-${counter++}`;
      watchId = id;
      const off = await listen<WatchBatch>("watch://batch", (ev) => {
        if (ev.payload.watchId === id) handle(ev.payload.deltas);
      });
      if (disposed || watchId !== id) {
        off();
        return;
      }
      unlisten = off;
      try {
        await api.startWatch(id, {
          context,
          spec,
          namespaces: scopeList.filter(Boolean),
          labelSelector,
        });
      } catch (e) {
        // The client could not even be built (e.g. expired GKE token):
        // keep trying with plain polling so the view recovers on its own.
        if (disposed || watchId !== id) return;
        useAppStore.getState().reportError(e, context, { silent: true });
        setError(e);
        startPolling();
      }
    };

    let initial = targetNamespaces(selection, kind);
    if (initial[0] === "" && spec.namespaced && isForbidden(context, kind, "")) {
      initial = fallbackNamespaces(context, kind);
      if (initial.length === 0) {
        needsNamespace();
        return;
      }
    }
    void startWatch(initial);

    return () => {
      disposed = true;
      stopWatch();
      window.clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, specKey, selKey, labelSelector, enabled, pollMs, nonce, manualKey, listedCount]);

  const refresh = useMemo(
    () => () => {
      forgetForbidden(context);
      setNonce((n) => n + 1);
    },
    [context],
  );

  return { items, loading, error, mode, refresh };
}
