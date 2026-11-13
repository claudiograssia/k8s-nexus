import { beforeEach, describe, expect, it, vi } from "vitest";

// The store (and through it the Tauri bridge) is replaced by a plain object.
const store = {
  namespacesByContext: {} as Record<string, string[]>,
  manualNamespaces: {} as Record<string, string[]>,
  contextByName: (_: string) => undefined as { namespace?: string } | undefined,
};
vi.mock("@/store/useAppStore", () => ({ useAppStore: { getState: () => store } }));
vi.mock("./api", () => ({ api: {} }));

const { fetchScoped, forgetForbidden, isNeedsNamespace, targetNamespaces } = await import("./listing");

const forbidden = { kind: "forbidden", message: "forbidden" };
const pods = { id: "/pods", namespaced: true };
const all = { namespaceMode: "all" as const, namespaces: [] };

describe("targetNamespaces", () => {
  it("is cluster-wide for all-namespaces, empty selections and cluster-scoped kinds", () => {
    expect(targetNamespaces(all, pods)).toEqual([""]);
    expect(targetNamespaces({ namespaceMode: "multi", namespaces: [] }, pods)).toEqual([""]);
    expect(targetNamespaces({ namespaceMode: "single", namespaces: ["a"] }, { id: "/nodes", namespaced: false })).toEqual([""]);
    expect(targetNamespaces({ namespaceMode: "multi", namespaces: ["a", "b"] }, pods)).toEqual(["a", "b"]);
  });
});

describe("fetchScoped", () => {
  let ctx = 0;
  let context = "";
  beforeEach(() => {
    context = `ctx-${++ctx}`; // denied scopes are remembered per context
    store.namespacesByContext = {};
    store.manualNamespaces = {};
    store.contextByName = () => undefined;
  });

  it("merges the results of each selected namespace and skips denied ones", async () => {
    const fetcher = vi.fn(async (ns: string | null) => {
      if (ns === "secret") throw forbidden;
      return [`${ns}-pod`];
    });
    const out = await fetchScoped(context, { namespaceMode: "multi", namespaces: ["a", "secret", "b"] }, pods, "pods", fetcher);
    expect(out).toEqual(["a-pod", "b-pod"]);
  });

  it("falls back to known namespaces when the cluster-wide list is forbidden", async () => {
    store.manualNamespaces = { [context]: ["team-a"] };
    store.contextByName = () => ({ namespace: "team-b" });
    const fetcher = vi.fn(async (ns: string | null) => {
      if (ns === null) throw forbidden;
      return [ns];
    });
    expect(await fetchScoped(context, all, pods, "pods", fetcher)).toEqual(["team-a", "team-b"]);

    // The denial is remembered: the next call goes straight to the fallback.
    fetcher.mockClear();
    await fetchScoped(context, all, pods, "pods", fetcher);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["team-a", "team-b"]);

    // A manual refresh forgets it.
    forgetForbidden(context);
    fetcher.mockClear();
    await fetchScoped(context, all, pods, "pods", fetcher);
    expect(fetcher.mock.calls[0][0]).toBeNull();
  });

  it("asks for a namespace when nothing is known and the cluster-wide list is forbidden", async () => {
    const err = await fetchScoped(context, all, pods, "pods", async () => {
      throw forbidden;
    }).catch((e) => e);
    expect(isNeedsNamespace(err)).toBe(true);
    expect(err.message).toContain("Add a namespace");
  });

  it("rethrows errors that are not permission denials", async () => {
    const boom = { kind: "connection", message: "timeout" };
    await expect(
      fetchScoped(context, all, pods, "pods", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
