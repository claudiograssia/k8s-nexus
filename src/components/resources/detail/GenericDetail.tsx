import { Badge } from "@/components/ui/badge";
import { MetaBlock } from "./parts";
import { getNested } from "@/lib/catalog";
import type { KubeObject } from "@/lib/types";

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background/50 p-2 font-mono text-[11px] leading-relaxed text-foreground/85">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** GKE BackendConfig highlights (Cloud Armor / CDN / IAP + health check). */
function BackendConfigBadges({ obj }: { obj: KubeObject }) {
  const armor = getNested(obj, ["spec", "securityPolicy", "name"]);
  const cdn = getNested(obj, ["spec", "cdn", "enabled"]);
  const iap = getNested(obj, ["spec", "iap", "enabled"]);
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={armor ? "ok" : "muted"}>Cloud Armor: {armor ? String(armor) : "off"}</Badge>
      <Badge tone={cdn ? "ok" : "muted"}>Cloud CDN: {cdn ? "on" : "off"}</Badge>
      <Badge tone={iap ? "ok" : "muted"}>IAP: {iap ? "on" : "off"}</Badge>
    </div>
  );
}

export function GenericDetail({ obj }: { obj: KubeObject }) {
  const isBackendConfig = obj.kind === "BackendConfig";
  return (
    <div className="space-y-4">
      {isBackendConfig && <BackendConfigBadges obj={obj} />}
      <MetaBlock obj={obj} />
      <JsonBlock title="Spec" value={obj.spec} />
      <JsonBlock title="Status" value={obj.status} />
    </div>
  );
}
