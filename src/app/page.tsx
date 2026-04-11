import { DashboardShell } from "@/components/layout/DashboardShell";
import { DashboardTabs } from "@/components/layout/DashboardTabs";
import { VolumePanel } from "@/components/panels/VolumePanel";
import { BundlesPanel } from "@/components/panels/BundlesPanel";
import { ClientsPanel } from "@/components/panels/ClientsPanel";
import { InsightsPanel } from "@/components/panels/InsightsPanel";
import { PackagesPanel } from "@/components/panels/PackagesPanel";
import { ListingStatusPanel } from "@/components/panels/ListingStatusPanel";

const analytics = (
  <>
    <div className="mb-8">
      <InsightsPanel />
    </div>
    <div className="mb-8">
      <PackagesPanel />
    </div>
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <BundlesPanel />
      <VolumePanel />
      <div className="lg:col-span-2">
        <ClientsPanel />
      </div>
    </div>
  </>
);

const tracker = <ListingStatusPanel />;

export default function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardTabs analytics={analytics} tracker={tracker} />
    </DashboardShell>
  );
}
