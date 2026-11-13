import { useMemo } from "react";
import { Loader2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { eventTime, tsOf } from "@/lib/catalog";
import { isAppError, type GvkSpec, type KubeObject } from "@/lib/types";
import { formatAge, getString } from "@/lib/utils";
import { useResourceList } from "@/components/common/useResourceList";

const EVENT_GVK: GvkSpec = { group: "", version: "v1", kind: "Event", plural: "events", namespaced: true };

/**
 * Live events about one object, matched by `involvedObject.uid`. Events of a
 * namespaced object live in its namespace; those of cluster-scoped objects
 * (nodes, PVs) usually in `default`, so they are looked up cluster-wide.
 */
export function useObjectEvents(context: string, obj: KubeObject) {
  const uid = obj.metadata?.uid;
  const namespace = obj.metadata?.namespace;
  const selection = useMemo(
    () =>
      namespace
        ? { namespaceMode: "single" as const, namespaces: [namespace] }
        : { namespaceMode: "all" as const, namespaces: [] },
    [namespace],
  );
  const { items, loading, error } = useResourceList({
    context,
    spec: EVENT_GVK,
    selection,
    fieldSelector: uid ? `involvedObject.uid=${uid}` : null,
    enabled: !!uid,
    pollMs: 10_000,
  });

  const events = useMemo(
    () => [...items].sort((a, b) => tsOf(eventTime(b)) - tsOf(eventTime(a))),
    [items],
  );
  return { events, loading, error };
}

/** Events tab of the detail panel. */
export function EventsPanel({ context, obj }: { context: string; obj: KubeObject }) {
  const { events, loading, error } = useObjectEvents(context, obj);

  if (error != null && events.length === 0) {
    const forbidden = isAppError(error) && error.kind === "forbidden";
    return (
      <div className="flex items-start gap-2 p-3 text-[12px] text-muted-foreground">
        {forbidden && <Lock className="mt-0.5 size-3.5 shrink-0" />}
        <p className="select-text">
          {forbidden ? "You are not allowed to read events here." : "Could not load events: "}
          {!forbidden && (isAppError(error) ? error.message : String(error))}
        </p>
      </div>
    );
  }
  if (loading && events.length === 0) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <p className="p-3 text-[12px] text-muted-foreground">
        No events. The cluster keeps them for about an hour.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {events.map((e) => {
        const warning = getString(e, "type") === "Warning";
        const count = typeof e["count"] === "number" ? (e["count"] as number) : 1;
        const source =
          getString(e, "source.component", "") || getString(e, "reportingComponent", "") || getString(e, "reportingController", "");
        return (
          <li key={e.metadata?.uid ?? e.metadata?.name} className="px-3 py-2 text-[12px]">
            <div className="flex items-center gap-2">
              <Badge tone={warning ? "warn" : "info"}>{getString(e, "type", "Normal")}</Badge>
              <span className="font-medium">{getString(e, "reason")}</span>
              {count > 1 && <span className="text-[11px] text-muted-foreground">×{count}</span>}
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {formatAge(eventTime(e))} ago
              </span>
            </div>
            <p className="mt-1 select-text whitespace-pre-wrap break-words text-muted-foreground">
              {getString(e, "message", "")}
            </p>
            {source && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{source}</p>}
          </li>
        );
      })}
    </ul>
  );
}
