import { useState } from "react";
import { X, ScrollText, Scaling, RotateCw, SquareTerminal, FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, objNamespace } from "@/lib/utils";
import type { ResourceType } from "@/lib/catalog";
import { supportsLogs } from "@/lib/catalog";
import type { KubeObject } from "@/lib/types";
import type { RowAction } from "./ResourceTable";
import { YamlEditor } from "@/components/yaml/YamlEditor";
import { ConfigMapDetail } from "./detail/ConfigMapDetail";
import { SecretDetail } from "./detail/SecretDetail";
import { PodDetail } from "./detail/PodDetail";
import { ServiceAccountDetail } from "./detail/ServiceAccountDetail";
import { GenericDetail } from "./detail/GenericDetail";
import { RevisionsPanel } from "./detail/RevisionsPanel";
import { EventsPanel } from "./detail/EventsPanel";

interface Props {
  context: string;
  resourceType: ResourceType;
  obj: KubeObject;
  readOnly: boolean;
  /** RBAC verdict per action; denied actions are hidden. */
  allowed: (action: RowAction, obj: KubeObject) => boolean;
  onClose: () => void;
  onOpenLogs: (obj: KubeObject) => void;
  onScale: (obj: KubeObject) => void;
  onRestart: (obj: KubeObject) => void;
  onExec: (obj: KubeObject) => void;
  onFiles: (obj: KubeObject) => void;
}

function Overview({ context, resourceType, obj }: { context: string; resourceType: ResourceType; obj: KubeObject }) {
  switch (resourceType.detail) {
    case "pod":
      return <PodDetail context={context} obj={obj} />;
    case "configmap":
      return <ConfigMapDetail obj={obj} />;
    case "secret":
      return <SecretDetail obj={obj} />;
    case "serviceaccount":
      return <ServiceAccountDetail obj={obj} />;
    default:
      return <GenericDetail obj={obj} />;
  }
}

type DetailTab = "overview" | "events" | "revisions" | "yaml";

export function ResourceDetail({
  context,
  resourceType,
  obj,
  readOnly,
  allowed,
  onClose,
  onOpenLogs,
  onScale,
  onRestart,
  onExec,
  onFiles,
}: Props) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const name = obj.metadata?.name ?? "";
  const namespace = objNamespace(obj) ?? null;
  const can = (a: RowAction) => allowed(a, obj);
  const canLogs = supportsLogs(resourceType) && can("logs");
  const isPod = resourceType.detail === "pod";
  const hasRevisions = resourceType.id === "deployments";
  const isEvent = resourceType.gvk.kind === "Event";
  const tabs: DetailTab[] = [
    "overview",
    ...(isEvent ? [] : (["events"] as const)),
    ...(hasRevisions ? (["revisions"] as const) : []),
    "yaml",
  ];

  return (
    <div className="flex h-full w-[560px] shrink-0 flex-col border-l border-border bg-card/60">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {resourceType.gvk.kind}
            {namespace ? ` · ${namespace}` : ""}
          </p>
        </div>
        {isPod && can("exec") && (
          <Button size="xs" variant="outline" onClick={() => onExec(obj)}>
            <SquareTerminal /> Shell
          </Button>
        )}
        {isPod && can("files") && (
          <Button size="xs" variant="outline" onClick={() => onFiles(obj)}>
            <FolderTree /> Files
          </Button>
        )}
        {canLogs && (
          <Button size="xs" variant="outline" onClick={() => onOpenLogs(obj)}>
            <ScrollText /> Logs
          </Button>
        )}
        {resourceType.restartable && can("restart") && (
          <Button size="xs" variant="outline" onClick={() => onRestart(obj)} disabled={readOnly}>
            <RotateCw /> Restart
          </Button>
        )}
        {resourceType.scalable && can("scale") && (
          <Button size="xs" variant="outline" onClick={() => onScale(obj)} disabled={readOnly}>
            <Scaling /> Scale
          </Button>
        )}
        <Button size="iconSm" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-2 py-1 text-[12px] capitalize transition-colors",
              tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "yaml" ? "YAML" : t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "overview" ? (
          <div className="h-full overflow-y-auto p-3">
            <Overview context={context} resourceType={resourceType} obj={obj} />
          </div>
        ) : tab === "events" ? (
          <div className="h-full overflow-y-auto">
            <EventsPanel context={context} obj={obj} />
          </div>
        ) : tab === "revisions" ? (
          <div className="h-full overflow-y-auto">
            <RevisionsPanel context={context} obj={obj} namespace={namespace} />
          </div>
        ) : (
          <YamlEditor
            context={context}
            spec={resourceType.gvk}
            namespace={namespace}
            name={name}
            readOnly={readOnly || !can("edit")}
          />
        )}
      </div>
    </div>
  );
}
