"use client";

import { useMemo } from "react";
import { useSites } from "@/hooks/useSites";
import { computeMonthlyVolume, computeSeasonality } from "@/lib/data-transforms";
import { StatCard } from "@/components/layout/StatCard";
import { VolumeChart } from "@/components/charts/VolumeChart";
import { SeasonalityChart } from "@/components/charts/SeasonalityChart";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export function VolumePanel() {
  const { sites, isLoading, error } = useSites();

  const { monthly, seasonality, mtd, ytd, peak } = useMemo(() => {
    const monthly = computeMonthlyVolume(sites, 18);
    const seasonality = computeSeasonality(sites);
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentYear = String(now.getFullYear());
    const mtd = monthly.find((m) => m.month === currentMonth)?.count ?? 0;
    const ytd = monthly
      .filter((m) => m.month.startsWith(currentYear))
      .reduce((s, m) => s + m.count, 0);
    const peak = [...seasonality].sort((a, b) => b.index - a.index)[0];
    return { monthly, seasonality, mtd, ytd, peak };
  }, [sites]);

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error.message} />;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Shoot Volume</h2>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Shoots MTD" value={mtd} accent="blue" />
        <StatCard label="Shoots YTD" value={ytd} accent="green" />
        <StatCard label="Total All Time" value={sites.length} accent="purple" />
      </div>
      <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-gray-500 dark:text-gray-400">Monthly Volume (18 months)</p>
        <VolumeChart data={monthly} />
      </div>
      <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow-sm">
        <p className="mb-1 text-sm font-medium text-gray-500 dark:text-gray-400">Seasonality Index</p>
        <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
          Peak demand: <strong className="text-gray-600 dark:text-gray-300">{peak?.month}</strong> (index {peak?.index})
        </p>
        <SeasonalityChart data={seasonality} />
      </div>
    </section>
  );
}
