import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Regex,
  CaseSensitive,
  WholeWord,
  Download,
  Trash2,
  Play,
  Pause,
  X,
  ScrollText,
  ArrowDown,
  History,
} from "lucide-react";
import { cn, colorForString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/tooltip";
import { Boxes, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResizableHeight } from "@/components/common/useResizableHeight";
import { api } from "@/lib/api";
import type { LogLine } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

let sessionCounter = 0;

/** Longest common prefix of the pod names, trimmed to a `-` boundary so we
 *  don't cut a segment mid-way (e.g. "my-app-" from "my-app-7d9-abc"). */
function commonPodPrefix(names: string[]): string {
  if (names.length < 2) return "";
  let p = names[0];
  for (let i = 1; i < names.length; i++) {
    const n = names[i];
    let j = 0;
    while (j < p.length && j < n.length && p[j] === n[j]) j++;
    p = p.slice(0, j);
    if (!p) break;
  }
  const cut = p.lastIndexOf("-");
  return cut > 0 ? p.slice(0, cut + 1) : "";
}

/** Extract the HTTP response status from a log line, precisely enough to avoid
 *  matching byte counts / version numbers / IP octets.
 *  - Access logs:  `… "GET /x HTTP/1.1" 200 1234 …`  → the code right after the
 *    closing quote of the request.
 *  - Structured:   `status=404`, `"status":500`, `code: 503`. */
function httpStatus(message: string): number | null {
  let m = message.match(/"\s+(\d{3})\b/);
  if (!m) m = message.match(/\b(?:status(?:code)?|code)["'\s:=]+(\d{3})\b/i);
  if (!m) return null;
  const code = Number(m[1]);
  return code >= 100 && code <= 599 ? code : null;
}

/** 5xx → red, 4xx → yellow, everything else (1xx/2xx/3xx/unknown) → default. */
function httpTone(message: string): "err" | "warn" | null {
  const s = httpStatus(message);
  if (s === null) return null;
  if (s >= 500) return "err";
  if (s >= 400) return "warn";
  return null;
}

/** Docked, resizable log panel (bottom of the window), driven by store.logTarget. */
export function LogPanel() {
  const target = useAppStore((s) => s.logTarget);
  const closeLogs = useAppStore((s) => s.closeLogs);
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);

  const [lines, setLines] = useState<LogLine[]>([]);
  const [pods, setPods] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [follow, setFollow] = useState(true);
  // Show logs from the previous (crashed) instance instead of the live one.
  const [previous, setPrevious] = useState(false);
  // null = all containers (auto); otherwise a specific container name.
  const [container, setContainer] = useState<string | null>(target?.container ?? null);
  // Auto-scroll ("stick to bottom"). Turns off when the user scrolls up.
  const [stick, setStick] = useState(true);

  const { height, startResize } = useResizableHeight("logs", Math.round(window.innerHeight * 0.4));
  const sessionId = useRef<string>("");
  const unlisten = useRef<UnlistenFn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ignore scroll events we cause ourselves; track last position to detect
  // genuine upward (user) scrolls vs. content growth.
  const programmatic = useRef(false);
  const lastTop = useRef(0);

  // A stable identity for the current target so we restart the stream when it changes.
  const targetKey = target
    ? `${target.context}|${target.namespace}|${target.title}|${target.labelSelector ?? ""}|${(target.pods ?? []).join(",")}`
    : "";

  const stop = useCallback(async () => {
    unlisten.current.forEach((u) => u());
    unlisten.current = [];
    if (sessionId.current) {
      try {
        await api.stopLogs(sessionId.current);
      } catch {
        /* ignore */
      }
      sessionId.current = "";
    }
  }, []);

  const start = useCallback(async () => {
    if (!target) return;
    await stop();
    setLines([]);
    setStick(true);
    const id = `logs-${Date.now().toString(36)}-${sessionCounter++}`;
    sessionId.current = id;

    const lineUnlisten = await listen<LogLine>("log://line", (e) => {
      if (e.payload.sessionId !== id) return;
      setLines((prev) => {
        const next = prev.length > 5000 ? prev.slice(prev.length - 5000) : prev.slice();
        next.push(e.payload);
        return next;
      });
    });
    const errUnlisten = await listen<LogLine>("log://error", (e) => {
      if (e.payload.sessionId !== id) return;
      setLines((prev) => [...prev, e.payload]);
    });
    unlisten.current = [lineUnlisten, errUnlisten];

    try {
      const resolved = await api.startLogs(id, {
        context: target.context,
        namespace: target.namespace,
        pods: target.pods ?? [],
        labelSelector: target.labelSelector ?? null,
        container,
        follow,
        previous,
        tailLines: 500,
        filter: { query, regex, caseSensitive, wholeWord },
      });
      setPods(resolved);
    } catch (e) {
      reportError(e, target.context);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, follow, previous, query, regex, caseSensitive, wholeWord, container, stop, reportError]);

  // Reset per-target choices when the target changes.
  useEffect(() => {
    setContainer(target?.container ?? null);
    setPrevious(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // (Re)start whenever the target/filter/container changes (debounced).
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => void start(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, query, regex, caseSensitive, wholeWord, follow, previous, container]);

  // Stop the stream when the panel closes / unmounts.
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  // Pin to the bottom before paint (synchronous → no flicker during bursts).
  useLayoutEffect(() => {
    if (!stick) return;
    const el = scrollRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [lines, stick]);

  // Only DETACH on a genuine upward user scroll; only RE-ATTACH near the
  // bottom. Content growth (which never moves scrollTop up) can't unstick us,
  // and our own programmatic scrolls are ignored.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    if (programmatic.current) {
      programmatic.current = false;
      lastTop.current = top;
      return;
    }
    const distance = el.scrollHeight - top - el.clientHeight;
    if (top < lastTop.current - 4) {
      setStick(false);
    } else if (distance <= 80) {
      setStick(true);
    }
    lastTop.current = top;
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      programmatic.current = true;
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
    setStick(true);
  }, []);

  const podPrefix = useMemo(() => commonPodPrefix(pods), [pods]);
  const shortPod = useCallback(
    (p: string) => (podPrefix && p.startsWith(podPrefix) ? "…" + p.slice(podPrefix.length) : p),
    [podPrefix],
  );

  const podColors = useMemo(() => {
    const map: Record<string, string> = {};
    pods.forEach((p) => (map[p] = colorForString(p)));
    return map;
  }, [pods]);

  const exportLogs = async () => {
    try {
      const path = await save({
        defaultPath: `${target?.title ?? "logs"}.txt`,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (!path) return;
      const text = lines.map((l) => `[${l.pod}] ${l.message}`).join("\n");
      await api.writeTextFile(path, text);
      pushToast("success", `Exported ${lines.length} lines`);
    } catch (e) {
      reportError(e);
    }
  };

  if (!target) return null;

  return (
    <div
      className="flex w-full shrink-0 flex-col border-t border-border bg-card"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="group flex h-1.5 w-full shrink-0 cursor-row-resize items-center justify-center bg-border/50 transition-colors hover:bg-primary/60"
        title="Drag to resize"
      >
        <div className="h-0.5 w-10 rounded-full bg-muted-foreground/40 group-hover:bg-primary-foreground/70" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <ScrollText className="size-4 text-primary" />
        <span className="text-[13px] font-semibold">{target.title}</span>
        <span className="text-[11px] text-muted-foreground">
          {pods.length} pod{pods.length === 1 ? "" : "s"} · {lines.length} lines
        </span>
        <Button size="iconSm" variant="ghost" className="ml-auto" onClick={closeLogs}>
          <X />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-[200px] flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter (processed in Rust)…"
            className="h-7 text-[12px]"
          />
        </div>
        {target.containers && target.containers.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="outline" className="max-w-[180px] gap-1">
                <Boxes className="size-3.5 shrink-0" />
                <span className="truncate">{container ?? "All containers"}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setContainer(null)}>All containers</DropdownMenuItem>
              <DropdownMenuSeparator />
              {target.containers.map((c) => (
                <DropdownMenuItem key={c} onClick={() => setContainer(c)}>
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Toggle active={regex} onClick={() => setRegex((v) => !v)} label="Regular expression">
          <Regex />
        </Toggle>
        <Toggle active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} label="Case sensitive">
          <CaseSensitive />
        </Toggle>
        <Toggle active={wholeWord} onClick={() => setWholeWord((v) => !v)} label="Whole word">
          <WholeWord />
        </Toggle>
        <div className="mx-1 h-5 w-px bg-border" />
        <Toggle
          active={previous}
          onClick={() => setPrevious((v) => !v)}
          label="Previous instance — logs from the crashed/restarted container"
        >
          <History />
        </Toggle>
        <Toggle
          active={follow}
          onClick={() => setFollow((v) => !v)}
          label={previous ? "Follow disabled for previous logs" : follow ? "Following" : "Paused"}
          disabled={previous}
        >
          {follow ? <Pause /> : <Play />}
        </Toggle>
        <Hint label="Clear buffer">
          <Button size="iconSm" variant="ghost" onClick={() => setLines([])}>
            <Trash2 />
          </Button>
        </Hint>
        <Hint label="Export filtered logs to .txt">
          <Button size="iconSm" variant="ghost" onClick={exportLogs}>
            <Download />
          </Button>
        </Hint>
      </div>

      {/* Pod legend */}
      {pods.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-border px-3 py-1">
          {pods.map((p) => (
            <span key={p} className="flex items-center gap-1 text-[10px]" title={p}>
              <span className="size-2 rounded-full" style={{ background: podColors[p] }} />
              <span className="font-mono text-muted-foreground">{p}</span>
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-auto bg-[hsl(222_28%_6%)] p-2 font-mono text-[11.5px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">Waiting for log lines…</p>
          ) : (
            lines.map((l, i) => {
              const tone = httpTone(l.message);
              return (
                <div key={i} className="flex gap-2 whitespace-pre-wrap break-all hover:bg-white/5">
                  {pods.length > 1 && (
                    <span
                      className="max-w-[160px] shrink-0 select-none truncate"
                      style={{ color: podColors[l.pod] ?? colorForString(l.pod) }}
                      title={l.pod}
                    >
                      {shortPod(l.pod)}
                    </span>
                  )}
                  <span
                    className={cn(
                      "min-w-0 flex-1",
                      tone === "err"
                        ? "text-[hsl(var(--err))]"
                        : tone === "warn"
                          ? "text-[hsl(var(--warn))]"
                          : "text-foreground/90",
                    )}
                  >
                    {l.message}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {!stick && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-3 right-4 z-10 flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
          >
            <ArrowDown className="size-3" /> In fondo
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex size-7 items-center justify-center rounded-md border transition-colors [&_svg]:size-3.5 disabled:opacity-40",
          active
            ? "border-primary bg-primary/15 text-primary"
            : "border-border text-muted-foreground hover:bg-accent",
        )}
      >
        {children}
      </button>
    </Hint>
  );
}
