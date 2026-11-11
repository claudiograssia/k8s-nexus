import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/useAppStore", () => ({ accessKey: () => "", useAppStore: () => undefined }));

const { actionsFor, checksFor } = await import("./permissions");
const { CATALOG_BY_ID } = await import("./catalog");

const rt = (id: string) => CATALOG_BY_ID.get(id)!;

describe("permissions", () => {
  it("offers pod-only actions on pods and node actions on nodes", () => {
    expect(actionsFor(rt("pods"))).toEqual(expect.arrayContaining(["logs", "exec", "attach", "debug", "files"]));
    expect(actionsFor(rt("nodes"))).toEqual(expect.arrayContaining(["cordon", "drain"]));
    expect(actionsFor(rt("configmaps"))).not.toContain("exec");
  });

  it("maps actions to the RBAC checks they need", () => {
    expect(checksFor("delete", rt("deployments"), "web")).toEqual([
      { group: "apps", resource: "deployments", verb: "delete", namespace: "web" },
    ]);
    expect(checksFor("logs", rt("pods"), "web")).toEqual([
      { group: "", resource: "pods", subresource: "log", verb: "get", namespace: "web" },
    ]);
    // Workload logs also need to list the pods behind the selector.
    expect(checksFor("logs", rt("deployments"), "web")).toHaveLength(2);
    expect(checksFor("debug", rt("pods"), "web").map((c) => c.subresource)).toEqual(["ephemeralcontainers", "attach"]);
  });

  it("drops the namespace for cluster-scoped kinds", () => {
    expect(checksFor("cordon", rt("nodes"), "web")[0].namespace).toBeNull();
  });
});
