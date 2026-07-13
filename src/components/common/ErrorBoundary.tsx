import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertOctagon } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Remount the boundary (clearing the error) when this key changes. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  info: string;
}

/** Catches render-time crashes in a subtree and shows the error instead of a
 *  blank window, keeping the rest of the app (tabs, header) usable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the devtools console as well.
    console.error("KubeNexus render error:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? "" });
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: "" });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col gap-3 overflow-auto p-6">
          <div className="flex items-center gap-2 text-[hsl(var(--err))]">
            <AlertOctagon className="size-5" />
            <h2 className="text-base font-semibold">This view crashed</h2>
          </div>
          <p className="text-[13px] text-muted-foreground">
            A rendering error occurred. The rest of the app is still usable — switch tabs or views.
          </p>
          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[12px] text-[hsl(var(--err))]">
            {this.state.error.name}: {this.state.error.message}
          </pre>
          {this.state.info && (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background/40 p-3 font-mono text-[11px] text-muted-foreground">
              {this.state.info}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
