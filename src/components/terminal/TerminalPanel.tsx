import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { useResizableHeight } from "@/components/common/useResizableHeight";
import { api } from "@/lib/api";
import { useAppStore, shortClusterName } from "@/store/useAppStore";

let ptyCounter = 0;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

const THEME = {
  background: "#0d1117",
  foreground: "#e5e9f0",
  cursor: "#38e8d2",
  selectionBackground: "#264f78",
  black: "#0d1117",
  brightBlack: "#4b5263",
};

export function TerminalPanel() {
  const open = useAppStore((s) => s.terminalOpen);
  const setOpen = useAppStore((s) => s.setTerminalOpen);
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const exec = useAppStore((s) => s.execTarget);
  const reportError = useAppStore((s) => s.reportError);
  const pushToast = useAppStore((s) => s.pushToast);
  const context = exec ? exec.context : activeTab?.context ?? null;
  const title = exec ? exec.title : context ? shortClusterName(context) : "no cluster";

  const hostRef = useRef<HTMLDivElement>(null);
  const { height, startResize } = useResizableHeight("terminal", Math.round(window.innerHeight * 0.42));

  // Restart the session when the exec target or cluster changes.
  const sessionKey = exec
    ? `exec:${exec.context}:${exec.namespace}:${exec.pod}:${exec.container ?? ""}:${exec.mode}`
    : context
      ? `shell:${context}`
      : "";

  useEffect(() => {
    if (!open || !context || !hostRef.current) return;

    const term = new Terminal({
      fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* container not measured yet */
    }

    const id = `pty-${Date.now().toString(36)}-${ptyCounter++}`;
    let cancelled = false;
    let unlisteners: Array<() => void> = [];

    const onData = term.onData((d) => void api.ptyWrite(id, d));

    (async () => {
      const unData = await listen<{ id: string; data: string }>("pty://data", (e) => {
        if (e.payload.id === id) term.write(b64ToBytes(e.payload.data));
      });
      const unExit = await listen<{ id: string }>("pty://exit", (e) => {
        if (e.payload.id === id) term.write("\r\n\x1b[90m[process exited — reopen to reconnect]\x1b[0m\r\n");
      });
      if (cancelled) {
        unData();
        unExit();
        return;
      }
      unlisteners = [unData, unExit];
      try {
        if (exec) {
          await api.ptyOpenExec(
            id,
            exec.context,
            exec.namespace,
            exec.pod,
            exec.container ?? null,
            exec.mode,
            exec.shell ?? null,
            term.rows,
            term.cols,
          );
        } else {
          await api.ptyOpen(id, context, null, term.rows, term.cols);
        }
      } catch (e) {
        reportError(e, context);
      }
    })();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void api.ptyResize(id, term.rows, term.cols);
      } catch {
        /* ignore transient resize errors */
      }
    });
    ro.observe(hostRef.current);
    term.focus();

    return () => {
      cancelled = true;
      onData.dispose();
      ro.disconnect();
      unlisteners.forEach((u) => u());
      void api.ptyClose(id);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionKey]);

  if (!open) return null;

  return (
    <div
      className="flex w-full shrink-0 flex-col border-t border-border bg-[#0d1117]"
      style={{ height }}
    >
      {/* Drag handle — resize the terminal height. */}
      <div
        onMouseDown={startResize}
        className="group flex h-1.5 w-full shrink-0 cursor-row-resize items-center justify-center bg-border/50 transition-colors hover:bg-primary/60"
        title="Drag to resize"
      >
        <div className="h-0.5 w-10 rounded-full bg-muted-foreground/40 group-hover:bg-primary-foreground/70" />
      </div>
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        <TerminalSquare className="size-4 text-primary" />
        <span className="text-[13px] font-semibold">{exec ? (exec.mode === "attach" ? "Attach" : "Shell") : "Terminal"}</span>
        <span className="truncate text-[11px] text-muted-foreground">{title}</span>
        {context && !exec && (
          <Hint label="Open in a native OS terminal window instead">
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => {
                void api.openTerminal(context, null).catch((e) => reportError(e, context));
                pushToast("info", "Opening native terminal…");
              }}
            >
              <ExternalLink />
            </Button>
          </Hint>
        )}
        <Button size="iconSm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
      {context ? (
        <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-1.5" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
          Open a cluster tab to start a terminal.
        </div>
      )}
    </div>
  );
}
