// What a node can host and what its pods have reserved, the way the scheduler
// counts it (same numbers as "Allocated resources" in `kubectl describe node`).

import type { KubeObject } from "./types";
import { parseCpuMilli, parseMemBytes } from "./quantity";

export interface Amounts {
  cpuMilli: number;
  memBytes: number;
}

export interface PodResources {
  requests: Amounts;
  limits: Amounts;
  /** Some container has no CPU / memory limit: it may use the whole node. */
  unlimitedCpu: boolean;
  unlimitedMem: boolean;
}

interface ContainerRes {
  resources?: { requests?: Record<string, unknown>; limits?: Record<string, unknown> };
}

const amounts = (r?: Record<string, unknown>): Amounts => ({
  cpuMilli: parseCpuMilli(r?.cpu),
  memBytes: parseMemBytes(r?.memory),
});

const add = (a: Amounts, b: Amounts): Amounts => ({
  cpuMilli: a.cpuMilli + b.cpuMilli,
  memBytes: a.memBytes + b.memBytes,
});

const max = (a: Amounts, b: Amounts): Amounts => ({
  cpuMilli: Math.max(a.cpuMilli, b.cpuMilli),
  memBytes: Math.max(a.memBytes, b.memBytes),
});

const ZERO: Amounts = { cpuMilli: 0, memBytes: 0 };

/**
 * Effective requests and limits of a pod: the sum over its containers, or the
 * largest init container if that is higher (init containers run one at a
 * time, before the others), plus the runtime-class overhead.
 */
export function podResources(pod: KubeObject): PodResources {
  const spec = (pod.spec ?? {}) as {
    containers?: ContainerRes[];
    initContainers?: (ContainerRes & { restartPolicy?: string })[];
    overhead?: Record<string, unknown>;
  };
  const containers = spec.containers ?? [];
  // Sidecars (init containers with restartPolicy Always) keep running.
  const sidecars = (spec.initContainers ?? []).filter((c) => c.restartPolicy === "Always");
  const inits = (spec.initContainers ?? []).filter((c) => c.restartPolicy !== "Always");
  const running = [...containers, ...sidecars];

  const sum = (key: "requests" | "limits") =>
    running.reduce((acc, c) => add(acc, amounts(c.resources?.[key])), ZERO);
  const initMax = (key: "requests" | "limits") =>
    inits.reduce((acc, c) => max(acc, amounts(c.resources?.[key])), ZERO);
  const overhead = amounts(spec.overhead);

  return {
    requests: add(max(sum("requests"), initMax("requests")), overhead),
    limits: add(max(sum("limits"), initMax("limits")), overhead),
    unlimitedCpu: running.some((c) => c.resources?.limits?.cpu === undefined),
    unlimitedMem: running.some((c) => c.resources?.limits?.memory === undefined),
  };
}

/** Pods that still hold resources on the node (not Succeeded / Failed). */
export function holdsResources(pod: KubeObject): boolean {
  const phase = (pod.status as { phase?: string } | undefined)?.phase;
  return phase !== "Succeeded" && phase !== "Failed";
}

export interface NodeAllocation {
  allocatable: Amounts & { pods: number };
  capacity: Amounts & { pods: number };
  requests: Amounts;
  limits: Amounts;
  /** Pods counted against the node's pod limit. */
  pods: number;
}

export function nodeAllocation(node: KubeObject, pods: KubeObject[]): NodeAllocation {
  const status = (node.status ?? {}) as {
    allocatable?: Record<string, unknown>;
    capacity?: Record<string, unknown>;
  };
  const withPods = (r?: Record<string, unknown>) => ({
    ...amounts(r),
    pods: Number.parseInt(String(r?.pods ?? "0"), 10) || 0,
  });
  const active = pods.filter(holdsResources);
  const all = active.map(podResources);
  return {
    allocatable: withPods(status.allocatable),
    capacity: withPods(status.capacity),
    requests: all.reduce((acc, r) => add(acc, r.requests), ZERO),
    limits: all.reduce((acc, r) => add(acc, r.limits), ZERO),
    pods: active.length,
  };
}

/** Share of `total` used by `part`, in percent (0 when total is unknown). */
export const percent = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);
