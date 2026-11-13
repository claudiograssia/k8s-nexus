import { useState } from "react";
import { FolderPlus, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNeedsNamespace } from "@/lib/listing";
import { isAppError } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

/**
 * Inline error for a list that could not load. When nothing is readable
 * cluster-wide it asks for a namespace the user has access to, adds it to the
 * context's manual namespaces and selects it in the tab.
 */
export function ListError({
  context,
  tabId,
  error,
  label,
}: {
  context: string;
  tabId: string;
  error: unknown;
  label: string;
}) {
  const addManualNamespace = useAppStore((s) => s.addManualNamespace);
  const updateTab = useAppStore((s) => s.updateTab);
  const [ns, setNs] = useState("");
  const forbidden = isAppError(error) && error.kind === "forbidden";
  const message = isAppError(error) ? error.message : String(error);

  const add = () => {
    const name = ns.trim();
    if (!name) return;
    addManualNamespace(context, name);
    updateTab(tabId, { namespaceMode: "single", namespaces: [name] });
    setNs("");
  };

  return (
    <div className="border-b border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)] px-3 py-2 text-[11px]">
      <div className="flex items-start gap-2">
        {forbidden ? (
          <Lock className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--warn))]" />
        ) : (
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--warn))]" />
        )}
        <p className="min-w-0 flex-1 select-text break-words">
          <span className="font-semibold">{label} unavailable:</span>{" "}
          <span className="text-muted-foreground">{message}</span>
        </p>
      </div>
      {isNeedsNamespace(error) && (
        <form
          className="mt-2 flex items-center gap-2 pl-5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            placeholder="namespace"
            className="h-7 w-56 font-mono text-[12px]"
          />
          <Button size="xs" variant="outline" type="submit" disabled={!ns.trim()}>
            <FolderPlus /> Add namespace
          </Button>
        </form>
      )}
    </div>
  );
}
