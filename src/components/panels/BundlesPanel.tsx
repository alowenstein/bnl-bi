"use client";

import { useMemo } from "react";
import { useSites } from "@/hooks/useSites";
import { computeBundles, computeServiceFrequency } from "@/lib/data-transforms";
import { StatCard } from "@/components/layout/StatCard";
import { ServiceBreakdownChart } from "@/components/charts/ServiceBreakdownChart";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export function BundlesPanel() {
  const { sites, isLoading, error } = useSites();

  const { bundles, services, topBundle } = useMemo(() => {
    const bundles = computeBundles(sites).slice(0, 10);
    const services = computeServiceFrequency(sites);
    const topBundle = bundles[0];
    return { bundles, services, topBundle };
  }, [sites]);

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error.message} />;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Products &amp; Bundles</h2>
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Top Bundle"
          value={`${topBundle?.pct ?? 0}%`}
          sub={topBundle?.bundle ?? "—"}
          accent="blue"
        />
        <StatCard
          label="Services Offered"
          value={services.length}
          sub="unique service types"
          accent="green"
        />
        <StatCard
          label="Bundle Combos"
          value={bundles.length}
          sub="active combinations"
          accent="amber"
        />
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-gray-500">Service Frequency</p>
        <ServiceBreakdownChart data={services} total={sites.length} />
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-gray-500">Top Bundles by Volume</p>
        <div className="space-y-2">
          {bundles.map((b, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-gray-400">
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{b.bundle}</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {b.count} <span className="text-xs font-normal text-gray-400">({b.pct}%)</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full bg-blue-400"
                    style={{ width: `${b.pct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
