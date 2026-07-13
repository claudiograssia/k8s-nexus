import type { ClusterTab } from "@/store/useAppStore";
import { ResourceView } from "@/components/resources/ResourceView";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { FinOpsView } from "@/components/dashboard/FinOpsView";
import { NetworkingView } from "@/components/networking/NetworkingView";
import { IamView } from "@/components/iam/IamView";

export function ClusterView({ tab }: { tab: ClusterTab }) {
  switch (tab.view) {
    case "dashboard":
      return <DashboardView tab={tab} />;
    case "finops":
      return <FinOpsView tab={tab} />;
    case "networking":
      return <NetworkingView tab={tab} />;
    case "iam":
      return <IamView tab={tab} />;
    case "resources":
    default:
      return <ResourceView tab={tab} />;
  }
}
