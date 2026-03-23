"use client";

import { useMemo } from "react";
import { useSites } from "@/hooks/useSites";
import { computeClientActivity } from "@/lib/data-transforms";
import { StatCard } from "@/components/layout/StatCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export function ClientsPanel() {
  const { sites, isLoading, error } = useSites();

  const { clients, totalClients, repeatClients, topClient } = useMemo(() => {
    const clients = computeClientActivity(sites).slice(0, 20);
    const all = computeClientActivity(sites);
    const totalClients = all.length;
    const repeatClients = all.filter((c) => c.siteCount > 1).length;
    const topClient = all[0];
    return { clients, totalClients, repeatClients, topClient };
  }, [sites]);

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error.message} />;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Client Activity</h2>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Clients" value={totalClients} accent="blue" />
        <StatCard
          label="Repeat Clients"
          value={`${Math.round((repeatClients / totalClients) * 100)}%`}
          sub={`${repeatClients} clients with 2+ shoots`}
          accent="green"
        />
        <StatCard label="Top Client" value={topClient?.siteCount ?? 0} sub={topClient?.name ?? "—"} accent="purple" />
      </div>

      <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-gray-500 dark:text-gray-400">Top 20 Clients by Shoot Volume</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
                <th className="pb-2 text-left font-medium">#</th>
                <th className="pb-2 text-left font-medium">Client</th>
                <th className="pb-2 text-left font-medium">Brokerage</th>
                <th className="pb-2 text-right font-medium">Shoots</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={c.uid} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-2 pr-3 text-xs text-gray-400 dark:text-gray-500">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <p className="font-medium text-gray-800 dark:text-gray-200">{c.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{c.email}</p>
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-500 dark:text-gray-400">{c.group ?? "—"}</td>
                  <td className="py-2 text-right font-semibold text-gray-800 dark:text-gray-200">{c.siteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
