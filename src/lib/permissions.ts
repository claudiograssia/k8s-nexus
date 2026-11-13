// Which RBAC permission each UI action needs, and a hook to ask the cluster.
// Answers come from SelfSubjectAccessReview (cached in the store); unknown
// answers count as allowed so a failed probe never hides a working action.

import { useCallback } from "react";
import type { ResourceType } from "./catalog";
import type { AccessCheck } from "./types";
import type { RowAction } from "@/components/resources/ResourceTable";
import { accessKey, useAppStore } from "@/store/useAppStore";

const pods = (verb: string, subresource: string | null, namespace: string | null): AccessCheck => ({
  group: "",
  resource: "pods",
  subresource,
  verb,
  namespace,
});

/** Permissions needed to run `action` on an object of `rt` in `namespace`. */
export function checksFor(
  action: RowAction,
  rt: ResourceType,
  namespace: string | null,
): AccessCheck[] {
  const self = (verb: string): AccessCheck => ({
    group: rt.gvk.group,
    resource: rt.gvk.plural,
    verb,
    namespace: rt.gvk.namespaced ? namespace : null,
  });
  switch (action) {
    case "edit":
    case "scale":
    case "restart":
      return [self("patch")];
    case "delete":
      return [self("delete")];
    case "logs":
      // Workload logs first resolve the pods behind the selector.
      return rt.detail === "pod"
        ? [pods("get", "log", namespace)]
        : [pods("get", "log", namespace), pods("list", null, namespace)];
    case "exec":
    case "files":
      return [pods("create", "exec", namespace)];
    case "attach":
      return [pods("create", "attach", namespace)];
    case "debug":
      return [pods("patch", "ephemeralcontainers", namespace), pods("create", "attach", namespace)];
    case "trigger":
      return [{ group: "batch", resource: "jobs", verb: "create", namespace }];
    case "cordon":
    case "uncordon":
      return [self("patch")];
    case "drain":
      return [self("patch"), pods("create", "eviction", null)];
  }
}

/** Every action a resource type can offer (what ResourceTable may show). */
export function actionsFor(rt: ResourceType): RowAction[] {
  const out: RowAction[] = ["edit", "delete"];
  if (rt.detail === "pod") out.push("logs", "exec", "attach", "debug", "files");
  else if (["deployments", "statefulsets", "daemonsets", "replicasets", "jobs"].includes(rt.id))
    out.push("logs");
  if (rt.scalable) out.push("scale");
  if (rt.restartable) out.push("restart");
  if (rt.id === "cronjobs") out.push("trigger");
  if (rt.id === "nodes") out.push("cordon", "drain");
  return out;
}

export function usePermissions(context: string) {
  const access = useAppStore((s) => s.access);
  const ensureAccess = useAppStore((s) => s.ensureAccess);

  /** False only when the cluster said no to at least one check. */
  const can = useCallback(
    (checks: AccessCheck[]) => checks.every((c) => access[accessKey(context, c)] !== false),
    [access, context],
  );
  /** True only when the cluster explicitly said no to every check. */
  const deniedAll = useCallback(
    (checks: AccessCheck[]) =>
      checks.length > 0 && checks.every((c) => access[accessKey(context, c)] === false),
    [access, context],
  );
  const ensure = useCallback(
    (checks: AccessCheck[]) => ensureAccess(context, checks),
    [ensureAccess, context],
  );
  return { can, deniedAll, ensure };
}
