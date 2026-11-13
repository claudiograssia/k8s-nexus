import { useCallback, useEffect, useMemo, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Save, RotateCcw, GitCompareArrows, FileCode2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { isAppError, type GvkSpec } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

interface Props {
  context: string;
  spec: GvkSpec;
  namespace: string | null;
  name: string;
  /** When true, hides Apply and makes the editor read-only (Safe Mode). */
  readOnly?: boolean;
  onApplied?: () => void;
}

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderWhitespace: "none" as const,
  smoothScrolling: true,
};

export function YamlEditor({ context, spec, namespace, name, readOnly, onApplied }: Props) {
  const [original, setOriginal] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Message of a 409 from the last apply, awaiting the user's decision. */
  const [conflict, setConflict] = useState<{ message: string; fieldConflict: boolean } | null>(null);
  const pushToast = useAppStore((s) => s.pushToast);
  const reportError = useAppStore((s) => s.reportError);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const yaml = await api.getResourceYaml(context, spec, namespace, name);
      setOriginal(yaml);
      setValue(yaml);
    } catch (e) {
      reportError(e, context);
    } finally {
      setLoading(false);
    }
  }, [context, spec, namespace, name, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => value !== original, [value, original]);

  const apply = async (force = false) => {
    setSaving(true);
    setConflict(null);
    try {
      await api.applyResourceYaml(context, spec, value, force);
      pushToast("success", `${force ? "Force-applied" : "Applied"} ${spec.kind}/${name}`);
      await load();
      setMode("edit");
      onApplied?.();
    } catch (e) {
      if (isAppError(e) && e.kind === "conflict") {
        // Field conflicts can be forced; "object has been modified" needs a reload.
        setConflict({ message: e.message, fieldConflict: /conflict with|conflicts with/i.test(e.message) });
      } else {
        reportError(e, context);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card/40 px-2 py-1.5">
        <FileCode2 className="size-4 text-primary" />
        <span className="font-mono text-[11px] text-muted-foreground">
          {spec.kind}/{name}
        </span>
        {dirty && (
          <span className="rounded bg-[hsl(var(--warn)/0.15)] px-1.5 text-[10px] text-[hsl(var(--warn))]">
            modified
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="xs"
            variant={mode === "diff" ? "default" : "outline"}
            onClick={() => setMode((m) => (m === "diff" ? "edit" : "diff"))}
            disabled={!dirty}
          >
            <GitCompareArrows /> Live Diff
          </Button>
          <Button size="xs" variant="outline" onClick={() => void load()} disabled={saving}>
            <RotateCcw /> Reload
          </Button>
          {!readOnly && (
            <Button size="xs" onClick={() => void apply()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Apply
            </Button>
          )}
        </div>
      </div>
      {conflict && (
        <div className="border-b border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)] px-3 py-2 text-[11px]">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--warn))]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {conflict.fieldConflict
                  ? "Some fields are managed by someone else"
                  : "The object changed on the cluster"}
              </p>
              <pre className="mt-1 max-h-32 select-text overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                {conflict.message}
              </pre>
              <p className="mt-1 text-muted-foreground">
                {conflict.fieldConflict
                  ? "Forcing makes KubeNexus the owner of these fields. The other manager (e.g. Helm, Argo CD, a controller) may revert or fight the change."
                  : "Reload to get the latest version, then reapply your edits."}
              </p>
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="xs" variant="outline" onClick={() => setConflict(null)}>
              Cancel
            </Button>
            {conflict.fieldConflict ? (
              <Button size="xs" variant="destructive" onClick={() => void apply(true)} disabled={saving}>
                Force apply
              </Button>
            ) : (
              <Button size="xs" onClick={() => void load().then(() => setConflict(null))}>
                <RotateCcw /> Reload
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : mode === "diff" ? (
          <DiffEditor
            original={original}
            modified={value}
            language="yaml"
            theme="vs-dark"
            options={{ ...EDITOR_OPTIONS, readOnly: true, renderSideBySide: true }}
          />
        ) : (
          <Editor
            value={value}
            language="yaml"
            theme="vs-dark"
            onChange={(v) => setValue(v ?? "")}
            options={{ ...EDITOR_OPTIONS, readOnly: !!readOnly }}
          />
        )}
      </div>
    </div>
  );
}
