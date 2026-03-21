"use client";

import { useMemo } from "react";
import { useSites } from "@/hooks/useSites";
import { computePackageBreakdown, computeUpgradeRates } from "@/lib/data-transforms";
import { StatCard } from "@/components/layout/StatCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { PackageTier } from "@/types/hdph";

const TIER_COLORS: Record<PackageTier, { bar: string; badge: string; text: string }> = {
  Bronze: { bar: "bg-amber-700", badge: "bg-amber-100 text-amber-800", text: "text-amber-700" },
  Silver: { bar: "bg-slate-400", badge: "bg-slate-100 text-slate-700", text: "text-slate-600" },
  Gold: { bar: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-800", text: "text-yellow-600" },
  "À La Carte": { bar: "bg-gray-300", badge: "bg-gray-100 text-gray-600", text: "text-gray-500" },
};

const TIER_PRICES: Record<string, string> = {
  Bronze: "$299",
  Silver: "$599",
  Gold: "$1,299",
  "À La Carte": "—",
};

export function PackagesPanel() {
  const { sites, isLoading, error } = useSites();

  const { breakdown, upgradeRates, maxCount } = useMemo(() => {
    const breakdown = computePackageBreakdown(sites);
    const upgradeRates = computeUpgradeRates(sites);
    const maxCount = Math.max(...breakdown.map((b) => b.count), 1);
    return { breakdown, upgradeRates, maxCount };
  }, [sites]);

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error.message} />;

  const bronze = breakdown.find((b) => b.tier === "Bronze");
  const silver = breakdown.find((b) => b.tier === "Silver");
  const gold = breakdown.find((b) => b.tier === "Gold");
  const alaCarte = breakdown.find((b) => b.tier === "À La Carte");

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Package Tiers</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Bronze"
          value={bronze?.count ?? 0}
          sub={`${bronze?.pct ?? 0}% of shoots`}
          accent="amber"
        />
        <StatCard
          label="Silver"
          value={silver?.count ?? 0}
          sub={`${silver?.pct ?? 0}% of shoots`}
          accent="blue"
        />
        <StatCard
          label="Gold"
          value={gold?.count ?? 0}
          sub={`${gold?.pct ?? 0}% of shoots`}
          accent="amber"
        />
        <StatCard
          label="À La Carte"
          value={alaCarte?.count ?? 0}
          sub={`${alaCarte?.pct ?? 0}% of shoots`}
          accent="purple"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Volume by tier */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="mb-4 text-sm font-medium text-gray-500">Shoots by Package Tier</p>
          <div className="space-y-3">
            {breakdown.map((b) => {
              const colors = TIER_COLORS[b.tier];
              return (
                <div key={b.tier} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-right">
                    <span className={`text-sm font-semibold ${colors.text}`}>{b.tier}</span>
                    <div className="text-xs text-gray-400">{TIER_PRICES[b.tier]}</div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="h-4 w-full rounded-full bg-gray-100">
                        <div
                          className={`h-4 rounded-full ${colors.bar} transition-all`}
                          style={{ width: `${(b.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right">
                    <span className="text-sm font-bold text-gray-800">{b.count}</span>
                    <span className="ml-1 text-xs text-gray-400">({b.pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upgrade rates */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="mb-4 text-sm font-medium text-gray-500">Add-on Upgrade Rates</p>
          <div className="space-y-4">
            {upgradeRates.map((r) => {
              const colors = TIER_COLORS[r.tier];
              return (
                <div key={r.tier}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colors.badge}`}>
                      {r.tier}
                    </span>
                    <span className="text-xs text-gray-400">{r.total} shoots</span>
                  </div>
                  <div className="space-y-1.5 pl-2">
                    <UpgradeBar
                      label="Agent on Camera"
                      count={r.agentOnCamera}
                      pct={r.agentOnCameraPct}
                      color="bg-purple-400"
                    />
                    <UpgradeBar
                      label="+10 Photos"
                      count={r.additionalPhotos}
                      pct={r.additionalPhotosPct}
                      color="bg-blue-400"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-gray-400 italic">
            * Gold includes video in base price. Bronze/Silver with video add-on are counted in Gold.
          </p>
        </div>
      </div>
    </section>
  );
}

function UpgradeBar({
  label,
  count,
  pct,
  color,
}: {
  label: string;
  count: number;
  pct: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs text-gray-600">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs text-gray-700">
        {count} <span className="text-gray-400">({pct}%)</span>
      </span>
    </div>
  );
}
