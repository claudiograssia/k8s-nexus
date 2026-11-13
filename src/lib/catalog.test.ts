import { describe, expect, it } from "vitest";
import { CATALOG, CATALOG_BY_ID, discoveredId, inCatalog, resourceTypeById } from "./catalog";
import type { KubeObject } from "./types";

const cert = {
  group: "networking.gke.io",
  version: "v1beta1",
  kind: "ManagedCertificate",
  plural: "managedcertificates",
  namespaced: true,
};

describe("catalog", () => {
  it("has unique ids", () => {
    expect(CATALOG_BY_ID.size).toBe(CATALOG.length);
  });

  it("recognises kinds it already describes", () => {
    expect(inCatalog({ group: "", plural: "pods" })).toBe(true);
    expect(inCatalog({ group: "apps", plural: "deployments" })).toBe(true);
    expect(inCatalog({ group: "example.com", plural: "widgets" })).toBe(false);
  });

  it("builds a resource type from a discovered-kind id", () => {
    const id = discoveredId(cert);
    expect(id).toBe("api:networking.gke.io|v1beta1|ManagedCertificate|managedcertificates|1");
    const rt = resourceTypeById(id)!;
    expect(rt.gvk).toEqual(cert);
    expect(rt.columns.map((c) => c.header)).toEqual(["Name", "Namespace", "Status", "Age"]);
    expect(resourceTypeById(id)).toBe(rt); // cached
  });

  it("omits the namespace column for cluster-scoped kinds and handles the core group", () => {
    const rt = resourceTypeById(discoveredId({ ...cert, group: "", kind: "Thing", plural: "things", namespaced: false }))!;
    expect(rt.gvk.group).toBe("");
    expect(rt.columns.map((c) => c.header)).toEqual(["Name", "Status", "Age"]);
  });

  it("derives the status column from conditions, then phase", () => {
    const rt = resourceTypeById(discoveredId(cert))!;
    const status = rt.columns.find((c) => c.key === "status")!;
    const obj = (s: unknown) => ({ metadata: { name: "x" }, status: s }) as KubeObject;
    expect(status.accessor(obj({ conditions: [{ type: "Ready", status: "True" }] }))).toBe("Ready");
    expect(status.accessor(obj({ conditions: [{ type: "Available", status: "False" }] }))).toBe("Not ready");
    expect(status.accessor(obj({ phase: "Bound" }))).toBe("Bound");
    expect(status.accessor(obj(undefined))).toBe("—");
  });

  it("returns undefined for unknown or malformed ids", () => {
    expect(resourceTypeById("nope")).toBeUndefined();
    expect(resourceTypeById("api:onlygroup")).toBeUndefined();
  });
});
