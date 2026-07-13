import { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Folder,
  FileText,
  ArrowUp,
  RefreshCw,
  Save,
  X,
  Loader2,
  HardDrive,
  ChevronRight,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { FileEntry } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: string;
  namespace: string;
  pod: string;
  containers: string[];
}

const EXT_LANG: Record<string, string> = {
  yaml: "yaml", yml: "yaml", json: "json", js: "javascript", ts: "typescript",
  sh: "shell", bash: "shell", py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", xml: "xml", html: "html", css: "css", sql: "sql", toml: "ini",
  ini: "ini", conf: "ini", env: "ini", md: "markdown", properties: "ini",
};

function langFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

function joinPath(dir: string, name: string): string {
  return (dir.endsWith("/") ? dir : `${dir}/`) + name;
}

function parentPath(dir: string): string {
  const trimmed = dir.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

export function PodFilesDialog({ open, onOpenChange, context, namespace, pod, containers }: Props) {
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);

  const [container, setContainer] = useState<string | null>(containers[0] ?? null);
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingDir, setLoadingDir] = useState(false);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = content !== original;

  const listDir = useCallback(
    async (target: string) => {
      setLoadingDir(true);
      try {
        const items = await api.podListDir(context, namespace, pod, container, target);
        setEntries(items);
        setPath(target);
      } catch (e) {
        reportError(e, context);
      } finally {
        setLoadingDir(false);
      }
    },
    [context, namespace, pod, container, reportError],
  );

  // Load root (and reload) when the dialog opens or the container changes.
  useEffect(() => {
    if (!open) return;
    setFilePath(null);
    setContent("");
    setOriginal("");
    void listDir("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, container]);

  const openFile = async (name: string) => {
    const full = joinPath(path, name);
    setLoadingFile(true);
    setFilePath(full);
    try {
      const text = await api.podReadFile(context, namespace, pod, container, full);
      setContent(text);
      setOriginal(text);
    } catch (e) {
      reportError(e, context);
      setFilePath(null);
    } finally {
      setLoadingFile(false);
    }
  };

  const save = async () => {
    if (!filePath) return;
    setSaving(true);
    try {
      await api.podWriteFile(context, namespace, pod, container, filePath, content);
      setOriginal(content);
      pushToast("success", `Saved ${filePath}`);
    } catch (e) {
      reportError(e, context);
    } finally {
      setSaving(false);
    }
  };

  const crumbs = useMemo(() => {
    const parts = path.split("/").filter(Boolean);
    const acc: { label: string; full: string }[] = [{ label: "/", full: "/" }];
    let cur = "";
    for (const p of parts) {
      cur += `/${p}`;
      acc.push({ label: p, full: cur });
    }
    return acc;
  }, [path]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => onOpenChange(false)}>
      <div
        className="flex h-[82vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <HardDrive className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">Files · {pod}</span>
          {containers.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="outline" className="ml-1">
                  {container}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {containers.map((c) => (
                  <DropdownMenuItem key={c} onClick={() => setContainer(c)}>
                    {c}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="iconSm" variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            <X />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: file browser */}
          <div className="flex w-80 shrink-0 flex-col border-r border-border">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1">
              <Button size="iconSm" variant="ghost" onClick={() => void listDir(parentPath(path))} disabled={path === "/"}>
                <ArrowUp />
              </Button>
              <Button size="iconSm" variant="ghost" onClick={() => void listDir(path)}>
                <RefreshCw className={loadingDir ? "animate-spin" : ""} />
              </Button>
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-[11px] text-muted-foreground">
                {crumbs.map((c, i) => (
                  <span key={c.full} className="flex shrink-0 items-center">
                    {i > 0 && <ChevronRight className="size-3 opacity-50" />}
                    <button className="rounded px-1 hover:text-foreground" onClick={() => void listDir(c.full)}>
                      {c.label}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1">
              {entries.map((e) => {
                const full = joinPath(path, e.name);
                const active = filePath === full;
                return (
                  <button
                    key={e.name}
                    onClick={() => (e.isDir ? void listDir(full) : void openFile(e.name))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors",
                      active ? "bg-accent text-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    {e.isDir ? (
                      <Folder className="size-3.5 shrink-0 text-[hsl(var(--info))]" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{e.name}</span>
                  </button>
                );
              })}
              {!loadingDir && entries.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">Empty directory.</p>
              )}
            </div>
          </div>

          {/* Right: editor */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {filePath ?? "Select a file to edit"}
              </span>
              {dirty && (
                <span className="rounded bg-[hsl(var(--warn)/0.15)] px-1.5 text-[10px] text-[hsl(var(--warn))]">
                  modified
                </span>
              )}
              <Button size="xs" onClick={save} disabled={!filePath || !dirty || saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
              </Button>
            </div>
            <div className="relative min-h-0 flex-1">
              {loadingFile ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : filePath ? (
                <Editor
                  value={content}
                  language={langFor(filePath)}
                  theme="vs-dark"
                  onChange={(v) => setContent(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                  Pick a file from the browser on the left.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
