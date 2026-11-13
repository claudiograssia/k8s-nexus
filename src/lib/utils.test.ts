import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode, formatAge, formatBytes, formatCpu, getString } from "./utils";
import type { KubeObject } from "./types";

describe("utils", () => {
  it("formats ages", () => {
    const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    expect(formatAge(ago(9))).toBe("9s");
    expect(formatAge(ago(12 * 60))).toBe("12m");
    expect(formatAge(ago(3 * 3600 + 5 * 60))).toBe("3h5m");
    expect(formatAge(ago(2 * 86400 + 3600))).toBe("2d1h");
    expect(formatAge(ago(12 * 86400))).toBe("12d");
    expect(formatAge(null)).toBe("—");
    expect(formatAge("not a date")).toBe("—");
  });

  it("formats bytes and cpu", () => {
    expect(formatBytes(0)).toBe("0");
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(1536)).toBe("1.5Ki");
    expect(formatBytes(256 * 1024 * 1024)).toBe("256Mi");
    expect(formatCpu(250)).toBe("250m");
    expect(formatCpu(1500)).toBe("1.50");
  });

  it("reads nested strings with a fallback", () => {
    const o = { metadata: { name: "x" }, status: { phase: "Running" } } as KubeObject;
    expect(getString(o, "status.phase")).toBe("Running");
    expect(getString(o, "status.missing")).toBe("—");
    expect(getString(o, "status.missing", "")).toBe("");
  });

  it("round-trips base64, including non-ASCII text", () => {
    for (const s of ["hello", "città — ✓"]) expect(base64Decode(base64Encode(s))).toBe(s);
  });
});
