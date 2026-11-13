import { describe, expect, it } from "vitest";
import { diagnosePod } from "./diagnose";
import type { KubeObject } from "./types";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function pod(status: Record<string, unknown>, spec: Record<string, unknown> = {}, metadata = {}): KubeObject {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "web-1", namespace: "default", uid: "u1", ...metadata },
    spec: { containers: [{ name: "app", image: "app:1" }], ...spec },
    status,
  } as KubeObject;
}

function event(reason: string, message: string, lastTimestamp: string, extra = {}): KubeObject {
  return {
    metadata: { name: `e-${reason}`, uid: `e-${reason}` },
    type: "Warning",
    reason,
    message,
    lastTimestamp,
    ...extra,
  } as KubeObject;
}

describe("diagnosePod", () => {
  it("reports nothing for a healthy pod", () => {
    const p = pod({
      phase: "Running",
      conditions: [{ type: "Ready", status: "True", lastTransitionTime: minutesAgo(30) }],
      containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: { running: {} } }],
    });
    expect(diagnosePod(p, [])).toEqual([]);
  });

  it("explains image pull errors", () => {
    const p = pod({
      containerStatuses: [
        {
          name: "app",
          ready: false,
          image: "app:missing",
          state: { waiting: { reason: "ImagePullBackOff", message: "Back-off pulling image" } },
        },
      ],
    });
    const [f] = diagnosePod(p);
    expect(f.severity).toBe("err");
    expect(f.title).toContain("cannot pull image");
    expect(f.container).toBe("app");
  });

  it("explains a crash loop with the last exit code", () => {
    const p = pod({
      containerStatuses: [
        {
          name: "app",
          restartCount: 7,
          state: { waiting: { reason: "CrashLoopBackOff" } },
          lastState: { terminated: { exitCode: 127, reason: "Error" } },
        },
      ],
    });
    const [f] = diagnosePod(p);
    expect(f.title).toBe("Container app keeps crashing (7 restarts)");
    expect(f.detail).toContain("exit code 127 — command not found");
  });

  it("suggests more memory when the crash loop is an OOM kill, without a duplicate finding", () => {
    const p = pod({
      containerStatuses: [
        {
          name: "app",
          restartCount: 3,
          state: { waiting: { reason: "CrashLoopBackOff" } },
          lastState: { terminated: { exitCode: 137, reason: "OOMKilled" } },
        },
      ],
    });
    const findings = diagnosePod(p);
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toMatch(/memory/);
  });

  it("reports an OOM kill of a running container with its memory limit", () => {
    const p = pod(
      {
        containerStatuses: [
          {
            name: "app",
            ready: true,
            restartCount: 1,
            state: { running: {} },
            lastState: { terminated: { exitCode: 137, reason: "OOMKilled" } },
          },
        ],
      },
      { containers: [{ name: "app", resources: { limits: { memory: "256Mi" } } }] },
    );
    const [f] = diagnosePod(p);
    expect(f.title).toBe("Container app was OOMKilled");
    expect(f.detail).toBe("Memory limit: 256Mi");
  });

  it("reports failed init containers and unschedulable pods", () => {
    const p = pod({
      conditions: [
        { type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/3 nodes are available" },
      ],
      initContainerStatuses: [{ name: "migrate", state: { terminated: { exitCode: 1 } } }],
    });
    const titles = diagnosePod(p).map((f) => f.title);
    expect(titles).toContain("Not scheduled: Unschedulable");
    expect(titles).toContain("Init container migrate failed");
  });

  it("flags pods stuck in Terminating with their finalizers", () => {
    const p = pod({}, {}, { deletionTimestamp: minutesAgo(10), finalizers: ["example.com/cleanup"] });
    const [f] = diagnosePod(p);
    expect(f.title).toBe("Stuck in Terminating");
    expect(f.detail).toContain("example.com/cleanup");
  });

  it("flags a running container that is not ready", () => {
    const p = pod(
      { containerStatuses: [{ name: "app", ready: false, started: true, state: { running: {} } }] },
      { containers: [{ name: "app", readinessProbe: { httpGet: { path: "/health" } } }] },
    );
    const [f] = diagnosePod(p);
    expect(f.severity).toBe("warn");
    expect(f.hint).toMatch(/readiness probe/);
  });

  it("marks warnings from before the pod became ready as history", () => {
    const p = pod({
      conditions: [{ type: "Ready", status: "True", lastTransitionTime: minutesAgo(5) }],
      containerStatuses: [{ name: "app", ready: true, state: { running: {} } }],
    });
    const old = event("Unhealthy", "Readiness probe failed", minutesAgo(10), { count: 4 });
    const [f] = diagnosePod(p, [old]);
    expect(f.severity).toBe("info");
    expect(f.title).toBe("Probe failing (×4) — before the pod became ready");
    expect(f.hint).toBeUndefined();
  });

  it("keeps current warnings, deduplicated by reason and sorted by severity", () => {
    const p = pod({
      conditions: [{ type: "Ready", status: "False" }],
      containerStatuses: [{ name: "app", ready: true, state: { running: {} } }],
    });
    const events = [
      event("Unhealthy", "Liveness probe failed", minutesAgo(1)),
      event("Unhealthy", "Readiness probe failed", minutesAgo(2)),
      event("FailedMount", 'configmap "cfg" not found', minutesAgo(1)),
      event("BackOff", "Back-off restarting", minutesAgo(1)),
      { ...event("Pulled", "ok", minutesAgo(1)), type: "Normal" } as KubeObject,
    ];
    const findings = diagnosePod(p, events);
    expect(findings.map((f) => f.title)).toEqual(["Volume mount failed", "Probe failing"]);
    expect(findings[0].severity).toBe("err");
    expect(findings[1].severity).toBe("warn");
  });
});
