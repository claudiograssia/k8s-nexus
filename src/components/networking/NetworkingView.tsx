import { useMemo, type CSSProperties } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { Network, RefreshCw, ShieldCheck } from "lucide-react";
import type { GvkSpec, KubeObject } from "@/lib/types";
import { getNested } from "@/lib/catalog";
import { useResourceList } from "@/components/common/useResourceList";
import { ListError } from "@/components/common/ListError";
import { LiveIndicator } from "@/components/common/LiveIndicator";
import { getString, truncate } from "@/lib/utils";
import { type ClusterTab } from "@/store/useAppStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CenteredSpinner } from "@/components/ui/spinner";

// GVK specs -----------------------------------------------------------------
const INGRESS_GVK: GvkSpec = {
  group: "networking.k8s.io",
  version: "v1",
  kind: "Ingress",
  plural: "ingresses",
  namespaced: true,
};
const SERVICE_GVK: GvkSpec = {
  group: "",
  version: "v1",
  kind: "Service",
  plural: "services",
  namespaced: true,
};
const GATEWAY_GVK: GvkSpec = {
  group: "gateway.networking.k8s.io",
  version: "v1",
  kind: "Gateway",
  plural: "gateways",
  namespaced: true,
};
const HTTPROUTE_GVK: GvkSpec = {
  group: "gateway.networking.k8s.io",
  version: "v1",
  kind: "HTTPRoute",
  plural: "httproutes",
  namespaced: true,
};
const BACKENDCONFIG_GVK: GvkSpec = {
  group: "cloud.google.com",
  version: "v1",
  kind: "BackendConfig",
  plural: "backendconfigs",
  namespaced: true,
};

// Narrowing helpers ----------------------------------------------------------
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
/** Stringify a scalar value for display, else fallback. */
function fmt(v: unknown, fallback = "—"): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string") return v.length ? v : fallback;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

/** Resolve the ingress class from spec or the legacy annotation. */
function ingressClass(o: KubeObject): string {
  return getString(
    o,
    "spec.ingressClassName",
    o.metadata?.annotations?.["kubernetes.io/ingress.class"] ?? "—",
  );
}
function isGceClass(cls: string): boolean {
  return /gce/i.test(cls);
}

/** Parse the `cloud.google.com/backend-config` annotation into referenced BC names. */
function parseBackendConfigRefs(anno: string): string[] {
  try {
    const parsed: unknown = JSON.parse(anno);
    const rec = asRecord(parsed);
    const names = new Set<string>();
    if (typeof rec.default === "string") names.add(rec.default);
    const ports = asRecord(rec.ports);
    for (const v of Object.values(ports)) {
      if (typeof v === "string") names.add(v);
    }
    return [...names];
  } catch {
    return [];
  }
}

const NODE_STYLE: CSSProperties = {
  background: "hsl(222 22% 11%)",
  border: "1px solid hsl(222 16% 20%)",
  color: "#e5e7eb",
  borderRadius: 8,
  padding: 8,
  fontSize: 11,
  width: 190,
};
const EDGE_STYLE: CSSProperties = { stroke: "hsl(222 16% 32%)" };
const EDGE_LABEL_STYLE: CSSProperties = { fill: "#9ca3af", fontSize: 10 };
const EDGE_LABEL_BG: CSSProperties = { fill: "hsl(222 22% 11%)" };

interface BackendConfigRef {
  name: string;
  bc?: KubeObject;
}
interface BackendConfigCard {
  service: KubeObject;
  refs: BackendConfigRef[];
}

export function NetworkingView({ tab }: { tab: ClusterTab }) {
  const live = (spec: GvkSpec) => ({ context: tab.context, spec, selection: tab });
  const ingressList = useResourceList(live(INGRESS_GVK));
  const serviceList = useResourceList(live(SERVICE_GVK));
  // CRDs that may not be installed: their errors are not shown.
  const gatewayList = useResourceList(live(GATEWAY_GVK));
  const routeList = useResourceList(live(HTTPROUTE_GVK));
  const backendConfigList = useResourceList(live(BACKENDCONFIG_GVK));

  const ingresses = ingressList.items;
  const services = serviceList.items;
  const gateways = gatewayList.items;
  const httproutes = routeList.items;
  const backendConfigs = backendConfigList.items;
  const loading = ingressList.loading || serviceList.loading;
  const ready = !loading || ingresses.length + services.length > 0;
  const coreError = ingressList.error ?? serviceList.error;
  const refresh = () => {
    for (const l of [ingressList, serviceList, gatewayList, routeList, backendConfigList]) l.refresh();
  };

  // (A) Topology graph -------------------------------------------------------
  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let col0 = 0; // ingress + gateway column (x=0)
    let col1 = 0; // route column (x=300)
    let col2 = 0; // service column (x=600)
    let eidx = 0;
    const serviceNodeIds = new Map<string, string>();
    const routeNodeIds = new Set<string>();

    const ensureService = (name: string): string => {
      const existing = serviceNodeIds.get(name);
      if (existing) return existing;
      const id = `svc/${name}`;
      serviceNodeIds.set(name, id);
      nodes.push({
        id,
        position: { x: 600, y: col2 * 90 },
        data: {
          label: (
            <div className="text-left leading-tight">
              <div className="opacity-60">Service</div>
              <div className="font-medium">{truncate(name, 24)}</div>
            </div>
          ),
        },
        style: NODE_STYLE,
      });
      col2++;
      return id;
    };

    // Ingress -> Service
    for (const ing of ingresses) {
      const name = ing.metadata?.name ?? "ingress";
      const ns = ing.metadata?.namespace ?? "";
      const cls = ingressClass(ing);
      const gce = isGceClass(cls);
      const ingId = `ing/${ns}/${name}`;
      nodes.push({
        id: ingId,
        position: { x: 0, y: col0 * 90 },
        data: {
          label: (
            <div className="text-left leading-tight">
              <div className="opacity-60">Ingress</div>
              <div className="font-medium">{truncate(name, 24)}</div>
              <div className="opacity-70">{cls}</div>
              {gce && (
                <span className="mt-1 inline-block">
                  <Badge tone="info">GKE / GCE</Badge>
                </span>
              )}
            </div>
          ),
        },
        style: NODE_STYLE,
      });
      col0++;

      for (const rule of asArray(getNested(ing, ["spec", "rules"]))) {
        const r = asRecord(rule);
        const host = asStr(r.host, "*");
        const http = asRecord(r.http);
        for (const path of asArray(http.paths)) {
          const p = asRecord(path);
          const pathStr = asStr(p.path, "/");
          const service = asRecord(asRecord(p.backend).service);
          const svcName = typeof service.name === "string" ? service.name : undefined;
          if (!svcName) continue;
          const svcId = ensureService(svcName);
          edges.push({
            id: `e${eidx++}`,
            source: ingId,
            target: svcId,
            label: `${host}${pathStr}`,
            style: EDGE_STYLE,
            labelStyle: EDGE_LABEL_STYLE,
            labelBgStyle: EDGE_LABEL_BG,
          });
        }
      }
    }

    // Gateway -> HTTPRoute -> Service
    for (const gw of gateways) {
      const gwName = gw.metadata?.name ?? "gateway";
      const gwNs = gw.metadata?.namespace ?? "";
      const gwId = `gw/${gwNs}/${gwName}`;
      nodes.push({
        id: gwId,
        position: { x: 0, y: col0 * 90 },
        data: {
          label: (
            <div className="text-left leading-tight">
              <div className="opacity-60">Gateway</div>
              <div className="font-medium">{truncate(gwName, 24)}</div>
              <div className="opacity-70">{getString(gw, "spec.gatewayClassName")}</div>
            </div>
          ),
        },
        style: NODE_STYLE,
      });
      col0++;

      for (const rt of httproutes) {
        const parents = asArray(getNested(rt, ["spec", "parentRefs"]));
        const refsThis = parents.some((p) => asRecord(p).name === gwName);
        if (!refsThis) continue;
        const rtName = rt.metadata?.name ?? "httproute";
        const rtNs = rt.metadata?.namespace ?? "";
        const rtId = `route/${rtNs}/${rtName}`;
        const firstSeen = !routeNodeIds.has(rtId);
        if (firstSeen) {
          routeNodeIds.add(rtId);
          nodes.push({
            id: rtId,
            position: { x: 300, y: col1 * 90 },
            data: {
              label: (
                <div className="text-left leading-tight">
                  <div className="opacity-60">HTTPRoute</div>
                  <div className="font-medium">{truncate(rtName, 24)}</div>
                </div>
              ),
            },
            style: NODE_STYLE,
          });
          col1++;
        }
        edges.push({
          id: `e${eidx++}`,
          source: gwId,
          target: rtId,
          style: EDGE_STYLE,
        });
        if (firstSeen) {
          for (const rule of asArray(getNested(rt, ["spec", "rules"]))) {
            for (const bref of asArray(asRecord(rule).backendRefs)) {
              const b = asRecord(bref);
              const svcName = typeof b.name === "string" ? b.name : undefined;
              if (!svcName) continue;
              const svcId = ensureService(svcName);
              edges.push({
                id: `e${eidx++}`,
                source: rtId,
                target: svcId,
                style: EDGE_STYLE,
              });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }, [ingresses, services, gateways, httproutes]);

  // (B) BackendConfig inspector ---------------------------------------------
  const bcByKey = useMemo(() => {
    const m = new Map<string, KubeObject>();
    for (const bc of backendConfigs) {
      m.set(`${bc.metadata?.namespace ?? ""}/${bc.metadata?.name ?? ""}`, bc);
    }
    return m;
  }, [backendConfigs]);

  const bcCards = useMemo<BackendConfigCard[]>(() => {
    const out: BackendConfigCard[] = [];
    for (const svc of services) {
      const anno = svc.metadata?.annotations?.["cloud.google.com/backend-config"];
      if (!anno) continue;
      const names = parseBackendConfigRefs(anno);
      if (names.length === 0) continue;
      const ns = svc.metadata?.namespace ?? "";
      const refs: BackendConfigRef[] = names.map((name) => ({
        name,
        bc: bcByKey.get(`${ns}/${name}`),
      }));
      out.push({ service: svc, refs });
    }
    return out;
  }, [services, bcByKey]);

  const gceCount = useMemo(
    () => ingresses.filter((o) => isGceClass(ingressClass(o))).length,
    [ingresses],
  );

  if (!ready) return <CenteredSpinner label="Loading networking topology…" />;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      {/* Header + summary */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-[hsl(var(--info))]" />
          <h2 className="text-[15px] font-semibold">Networking</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Badge tone="info">{ingresses.length} ingresses</Badge>
          <Badge tone={gceCount > 0 ? "ok" : "muted"}>{gceCount} GCE ingresses</Badge>
          <Badge tone="info">{gateways.length} gateways</Badge>
          <Badge tone={bcCards.length > 0 ? "ok" : "muted"}>
            {bcCards.length} services w/ BackendConfig
          </Badge>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LiveIndicator mode={ingressList.mode} />
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> Refresh
          </Button>
        </div>
      </div>

      {coreError != null && (
        <div className="-mx-4 -mb-2">
          <ListError
            context={tab.context}
            tabId={tab.id}
            error={coreError}
            label={ingressList.error != null ? "Ingresses" : "Services"}
          />
        </div>
      )}

      {/* (A) Topology graph */}
      <div className="h-[380px] overflow-hidden rounded-lg border border-border bg-card/40">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No ingress or gateway traffic topology found in scope.
          </div>
        ) : (
          <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2}>
            <Background />
            <Controls />
          </ReactFlow>
        )}
      </div>

      {/* (B) BackendConfig inspector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <h3 className="text-[13px] font-semibold">GKE BackendConfig inspector</h3>
        </div>
        {bcCards.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            No Services in scope reference a{" "}
            <span className="font-mono">cloud.google.com/backend-config</span> annotation.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bcCards.map((card) => {
              const svcName = card.service.metadata?.name ?? "—";
              const svcNs = card.service.metadata?.namespace ?? "—";
              return (
                <div
                  key={`${svcNs}/${svcName}`}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium">{svcName}</span>
                    <span className="text-[11px] text-muted-foreground">{svcNs}</span>
                  </div>
                  <div className="mt-2 flex flex-col gap-3">
                    {card.refs.map((ref) => (
                      <BackendConfigBlock key={ref.name} refName={ref.name} bc={ref.bc} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function BackendConfigBlock({ refName, bc }: { refName: string; bc?: KubeObject }) {
  if (!bc) {
    return (
      <div className="rounded-md border border-border/60 bg-background/40 p-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-mono">{refName}</span>
          <Badge tone="warn">not found</Badge>
        </div>
      </div>
    );
  }

  const hc = asRecord(getNested(bc, ["spec", "healthCheck"]));
  const hcEntries: [string, string][] = [
    ["requestPath", fmt(hc.requestPath, "/")],
    ["port", fmt(hc.port)],
    ["type", fmt(hc.type)],
    ["checkIntervalSec", fmt(hc.checkIntervalSec)],
    ["timeoutSec", fmt(hc.timeoutSec)],
    ["healthyThreshold", fmt(hc.healthyThreshold)],
    ["unhealthyThreshold", fmt(hc.unhealthyThreshold)],
  ];

  const armor = getNested(bc, ["spec", "securityPolicy", "name"]);
  const armorName = typeof armor === "string" && armor.length > 0 ? armor : null;
  const cdn = Boolean(getNested(bc, ["spec", "cdn", "enabled"]));
  const iap = Boolean(getNested(bc, ["spec", "iap", "enabled"]));

  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="opacity-60">BackendConfig</span>
        <span className="font-mono font-medium">{refName}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
        {hcEntries.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <span className="text-muted-foreground">{k}</span>
            <span className="truncate font-mono">{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={armorName ? "ok" : "muted"}>
          Cloud Armor: {armorName ?? "off"}
        </Badge>
        <Badge tone={cdn ? "ok" : "muted"}>Cloud CDN: {cdn ? "on" : "off"}</Badge>
        <Badge tone={iap ? "ok" : "muted"}>IAP: {iap ? "on" : "off"}</Badge>
      </div>
    </div>
  );
}
