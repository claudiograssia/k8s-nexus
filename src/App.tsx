import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/useAppStore";
import { TabBar } from "@/components/layout/TabBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { ClusterHeader } from "@/components/layout/ClusterHeader";
import { ResourceNav } from "@/components/layout/ResourceNav";
import { StatusBar } from "@/components/layout/StatusBar";
import { StartScreen } from "@/components/layout/StartScreen";
import { Toaster } from "@/components/Toaster";
import { ToolsBanner } from "@/components/ToolsBanner";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { LogPanel } from "@/components/logs/LogPanel";
import { PortForwardDrawer } from "@/components/portforward/PortForwardDrawer";
import { GkeAuthBanner } from "@/components/GkeAuthBanner";
import { ClusterView } from "@/components/ClusterView";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

export default function App() {
  const init = useAppStore((s) => s.init);
  const tabs = useAppStore((s) => s.tabs);
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <TabBar />
        <ToolsBanner />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            {activeTab ? (
              <ErrorBoundary resetKey={activeTab.id}>
                <ClusterHeader tab={activeTab} />
                <GkeAuthBanner tabContext={activeTab.context} />
                <div className="flex min-h-0 flex-1">
                  <ResourceNav tab={activeTab} />
                  <main className="min-w-0 flex-1 overflow-hidden">
                    <ErrorBoundary resetKey={`${activeTab.id}:${activeTab.view}:${activeTab.resourceId}`}>
                      <ClusterView tab={activeTab} />
                    </ErrorBoundary>
                  </main>
                </div>
              </ErrorBoundary>
            ) : (
              <StartScreen />
            )}
          </div>
        </div>
        <TerminalPanel />
        <LogPanel />
        <PortForwardDrawer />
        <StatusBar />
        <Toaster />
      </div>
      {tabs.length === 0 && <span className="sr-only">No open clusters</span>}
    </TooltipProvider>
  );
}
