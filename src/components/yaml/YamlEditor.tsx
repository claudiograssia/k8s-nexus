import { useCallback, useEffect, useMemo, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Save, RotateCcw, GitCompareArrows, FileCode2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { GvkSpec } from "@/lib/types";
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

  const apply = async () => {
    setSaving(true);
    try {
      await api.applyResourceYaml(context, spec, value);
      pushToast("success", `Applied ${spec.kind}/${name}`);
      await load();
      setMode("edit");
      onApplied?.();
    } catch (e) {
      reportError(e, context);
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
            <Button size="xs" onClick={apply} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Apply
            </Button>
          )}
        </div>
      </div>
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
