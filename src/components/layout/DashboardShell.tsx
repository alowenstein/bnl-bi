"use client";

import { useState } from "react";
import { useSites } from "@/hooks/useSites";
import { useInsights } from "@/hooks/useInsights";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { refresh: refreshSites } = useSites();
  const { refresh: refreshInsights } = useInsights();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refreshSites(), refreshInsights()]);
    setRefreshing(false);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Builds &apos;n Lenses BI</h1>
            <p className="text-xs text-gray-400">Real estate photography analytics</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <span className={refreshing ? "animate-spin" : ""}>↻</span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
