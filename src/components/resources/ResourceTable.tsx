import {
  MoreVertical,
  ScrollText,
  Pencil,
  Scaling,
  RotateCw,
  Trash2,
  SquareTerminal,
  Plug,
  PlayCircle,
  Ban,
  CircleCheck,
  Droplets,
  FolderTree,
  Bug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, objKey } from "@/lib/utils";
import type { ResourceType } from "@/lib/catalog";
import type { KubeObject } from "@/lib/types";

export type RowAction =
  | "edit"
  | "logs"
  | "scale"
  | "restart"
  | "delete"
  | "exec"
  | "attach"
  | "debug"
  | "files"
  | "trigger"
  | "cordon"
  | "uncordon"
  | "drain";

interface Props {
  resourceType: ResourceType;
  items: KubeObject[];
  selectedKey: string | null;
  readOnly: boolean;
  /** RBAC verdict per action; denied actions are hidden. */
  allowed: (action: RowAction, obj: KubeObject) => boolean;
  onRowClick: (obj: KubeObject) => void;
  onAction: (action: RowAction, obj: KubeObject) => void;
}

export function ResourceTable({
  resourceType,
  items,
  selectedKey,
  readOnly,
  allowed,
  onRowClick,
  onAction,
}: Props) {
  const canLogs = resourceType.detail === "pod" || hasSelector(resourceType);
  const isPod = resourceType.detail === "pod";
  const isCronjob = resourceType.id === "cronjobs";
  const isNode = resourceType.id === "nodes";

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border text-left text-muted-foreground">
            {resourceType.columns.map((c) => (
              <th key={c.key} className="px-3 py-1.5 font-medium" style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
            <th className="w-8 px-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((obj) => {
            const key = objKey(obj);
            const active = key === selectedKey;
            const can = (a: RowAction) => allowed(a, obj);
            const canScaleOrRestart =
              (resourceType.scalable && can("scale")) || (resourceType.restartable && can("restart"));
            return (
              <tr
                key={key}
                onClick={() => onRowClick(obj)}
                className={cn(
                  "cursor-pointer border-b border-border/50 transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/40",
                )}
              >
                {resourceType.columns.map((c) => {
                  const tone = c.tone?.(obj);
                  return (
                    <td key={c.key} className="px-3 py-1.5 align-middle">
                      {tone ? (
                        <Badge tone={tone}>{c.accessor(obj)}</Badge>
                      ) : (
                        <span className="block truncate">{c.accessor(obj)}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="iconSm" variant="ghost">
                        <MoreVertical />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onAction("edit", obj)}>
                        <Pencil /> {can("edit") && !readOnly ? "View / Edit YAML" : "View YAML"}
                      </DropdownMenuItem>
                      {canLogs && can("logs") && (
                        <DropdownMenuItem onClick={() => onAction("logs", obj)}>
                          <ScrollText /> Logs
                        </DropdownMenuItem>
                      )}
                      {isPod && (can("exec") || can("attach")) && (
                        <>
                          <DropdownMenuSeparator />
                          {can("exec") && (
                            <DropdownMenuItem onClick={() => onAction("exec", obj)}>
                              <SquareTerminal /> Shell (exec)
                            </DropdownMenuItem>
                          )}
                          {can("attach") && (
                            <DropdownMenuItem onClick={() => onAction("attach", obj)}>
                              <Plug /> Attach (distroless)
                            </DropdownMenuItem>
                          )}
                          {can("debug") && !readOnly && (
                            <DropdownMenuItem onClick={() => onAction("debug", obj)}>
                              <Bug /> Debug container
                            </DropdownMenuItem>
                          )}
                          {can("files") && (
                            <DropdownMenuItem onClick={() => onAction("files", obj)}>
                              <FolderTree /> Browse files
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                      {isCronjob && can("trigger") && (
                        <DropdownMenuItem onClick={() => onAction("trigger", obj)} disabled={readOnly}>
                          <PlayCircle /> Trigger now
                        </DropdownMenuItem>
                      )}
                      {isNode &&
                        can("cordon") &&
                        ((obj.spec as Record<string, unknown> | undefined)?.unschedulable === true ? (
                          <DropdownMenuItem onClick={() => onAction("uncordon", obj)} disabled={readOnly}>
                            <CircleCheck /> Uncordon
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => onAction("cordon", obj)} disabled={readOnly}>
                            <Ban /> Cordon
                          </DropdownMenuItem>
                        ))}
                      {isNode && can("drain") && (
                        <DropdownMenuItem onClick={() => onAction("drain", obj)} disabled={readOnly}>
                          <Droplets /> Drain…
                        </DropdownMenuItem>
                      )}
                      {canScaleOrRestart && <DropdownMenuSeparator />}
                      {resourceType.scalable && can("scale") && (
                        <DropdownMenuItem onClick={() => onAction("scale", obj)} disabled={readOnly}>
                          <Scaling /> Scale
                        </DropdownMenuItem>
                      )}
                      {resourceType.restartable && can("restart") && (
                        <DropdownMenuItem onClick={() => onAction("restart", obj)} disabled={readOnly}>
                          <RotateCw /> Restart
                        </DropdownMenuItem>
                      )}
                      {can("delete") && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            disabled={readOnly}
                            onClick={() => onAction("delete", obj)}
                          >
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && (
        <p className="py-10 text-center text-[12px] text-muted-foreground">No resources found.</p>
      )}
    </div>
  );
}

function hasSelector(rt: ResourceType): boolean {
  return ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs"].includes(rt.id);
}
