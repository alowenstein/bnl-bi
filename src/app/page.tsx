import { DashboardShell } from "@/components/layout/DashboardShell";
import { VolumePanel } from "@/components/panels/VolumePanel";
import { BundlesPanel } from "@/components/panels/BundlesPanel";
import { ClientsPanel } from "@/components/panels/ClientsPanel";
import { InsightsPanel } from "@/components/panels/InsightsPanel";

export default function DashboardPage() {
  return (
    <DashboardShell>
      {/* AI Insights — full width at top */}
      <div className="mb-8">
        <InsightsPanel />
      </div>

      {/* 2-column grid for data panels */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <BundlesPanel />
        <VolumePanel />
        <div className="lg:col-span-2">
          <ClientsPanel />
        </div>
      </div>
    </DashboardShell>
  );
}
