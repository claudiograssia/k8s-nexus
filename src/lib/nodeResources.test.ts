import { describe, expect, it } from "vitest";
import { nodeAllocation, podResources } from "./nodeResources";
import { parseCpuMilli, parseMemBytes } from "./quantity";
import type { KubeObject } from "./types";

const Mi = 1024 ** 2;

const container = (requests?: Record<string, string>, limits?: Record<string, string>) => ({
  name: "c",
  resources: { requests, limits },
});

const pod = (spec: Record<string, unknown>, phase = "Running") =>
  ({ metadata: { name: "p" }, spec, status: { phase } }) as KubeObject;

describe("quantities", () => {
  it("parses cpu", () => {
    expect(parseCpuMilli("250m")).toBe(250);
    expect(parseCpuMilli("1.5")).toBe(1500);
    expect(parseCpuMilli("250000000n")).toBeCloseTo(250);
    expect(parseCpuMilli("1500u")).toBeCloseTo(1.5);
    expect(parseCpuMilli(2)).toBe(2000);
    expect(parseCpuMilli(undefined)).toBe(0);
    expect(parseCpuMilli("abc")).toBe(0);
  });

  it("parses memory", () => {
    expect(parseMemBytes("128Mi")).toBe(128 * Mi);
    expect(parseMemBytes("1G")).toBe(1e9);
    expect(parseMemBytes("100k")).toBe(1e5);
    expect(parseMemBytes("4096")).toBe(4096);
    expect(parseMemBytes("1e3")).toBe(1000);
    expect(parseMemBytes("12Xi")).toBe(0);
    expect(parseMemBytes(undefined)).toBe(0);
  });
});

describe("podResources", () => {
  it("sums containers and flags missing limits", () => {
    const r = podResources(
      pod({
        containers: [
          container({ cpu: "100m", memory: "64Mi" }, { cpu: "200m", memory: "128Mi" }),
          container({ cpu: "50m", memory: "32Mi" }, { memory: "64Mi" }),
        ],
      }),
    );
    expect(r.requests).toEqual({ cpuMilli: 150, memBytes: 96 * Mi });
    expect(r.limits).toEqual({ cpuMilli: 200, memBytes: 192 * Mi });
    expect(r.unlimitedCpu).toBe(true);
    expect(r.unlimitedMem).toBe(false);
  });

  it("uses the largest init container when it asks for more, and adds sidecars and overhead", () => {
    const r = podResources(
      pod({
        containers: [container({ cpu: "100m", memory: "64Mi" })],
        initContainers: [
          container({ cpu: "500m", memory: "32Mi" }),
          { ...container({ cpu: "10m", memory: "16Mi" }), restartPolicy: "Always" },
        ],
        overhead: { cpu: "5m", memory: "1Mi" },
      }),
    );
    // cpu: max(100 + 10 sidecar, 500 init) + 5 overhead; memory: max(64 + 16, 32) + 1
    expect(r.requests).toEqual({ cpuMilli: 505, memBytes: 81 * Mi });
  });
});

describe("nodeAllocation", () => {
  it("adds up the pods still running against the allocatable resources", () => {
    const node = {
      metadata: { name: "n1" },
      status: {
        capacity: { cpu: "4", memory: "16Gi", pods: "110" },
        allocatable: { cpu: "3920m", memory: "13Gi", pods: "110" },
      },
    } as KubeObject;
    const a = nodeAllocation(node, [
      pod({ containers: [container({ cpu: "1", memory: "1Gi" }, { cpu: "2", memory: "2Gi" })] }),
      pod({ containers: [container({ cpu: "500m" })] }, "Pending"),
      pod({ containers: [container({ cpu: "4" })] }, "Succeeded"),
    ]);
    expect(a.allocatable).toEqual({ cpuMilli: 3920, memBytes: 13 * 1024 * Mi, pods: 110 });
    expect(a.capacity.cpuMilli).toBe(4000);
    expect(a.requests).toEqual({ cpuMilli: 1500, memBytes: 1024 * Mi });
    expect(a.limits).toEqual({ cpuMilli: 2000, memBytes: 2048 * Mi });
    expect(a.pods).toBe(2);
  });
});
