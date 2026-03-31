"use client";

import { useListingChanges } from "@/hooks/useListingChanges";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { ListingChange, ChangeType } from "@/types/listing-status";

const CHANGE_LABELS: Record<ChangeType, string> = {
  sold:           "Sold",
  pending:        "Pending / Under Contract",
  backup_offers:  "Accepting Backup Offers",
  price_change:   "Price Change",
  back_on_market: "Back on Market",
  off_market:     "Off Market",
};

const BADGE_CLASSES: Record<ChangeType, string> = {
  sold:           "bg-green-100  text-green-700  dark:bg-green-950  dark:text-green-300",
  pending:        "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  backup_offers:  "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  price_change:   "bg-blue-100   text-blue-700   dark:bg-blue-950   dark:text-blue-300",
  back_on_market: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  off_market:     "bg-gray-100   text-gray-600   dark:bg-gray-800   dark:text-gray-400",
};

function ChangeTypeBadge({ type }: { type: ChangeType }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE_CLASSES[type]}`}>
      {CHANGE_LABELS[type]}
    </span>
  );
}

function formatPrice(p: number | null): string {
  if (p === null) return "—";
  return `$${p.toLocaleString()}`;
}

function PriceDelta({ change }: { change: ListingChange }) {
  if (change.changeType !== "price_change" || change.priceDelta === null) return null;
  const isDown  = change.priceDelta < 0;
  const sign    = isDown ? "▼" : "▲";
  const color   = isDown ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400";
  const display = `${sign} $${Math.abs(change.priceDelta).toLocaleString()}`;
  return (
    <div className="text-xs mt-0.5">
      <span className="text-gray-400 dark:text-gray-500">
        {formatPrice(change.previousPrice)} → {formatPrice(change.currentPrice)}
      </span>
      <span className={`ml-1 font-semibold ${color}`}>{display}</span>
    </div>
  );
}

function ChangeRow({ change }: { change: ListingChange }) {
  const date    = new Date(change.detectedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const mlsText = change.mls ? `MLS# ${change.mls}` : "No MLS#";

  return (
    <tr className="border-t border-gray-100 dark:border-gray-700">
      <td className="py-3 pr-4 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
        {date}
      </td>
      <td className="py-3 pr-4">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {change.address}
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500">
          {change.city}, {change.state} · {mlsText}
        </div>
      </td>
      <td className="py-3 pr-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
        {change.agentName}
      </td>
      <td className="py-3 pr-4">
        <ChangeTypeBadge type={change.changeType} />
        <PriceDelta change={change} />
      </td>
      <td className="py-3 text-xs">
        <a
          href={change.zillowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Zillow ↗
        </a>
      </td>
    </tr>
  );
}

export function ListingStatusPanel() {
  const { changes, isLoading, error } = useListingChanges();

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error)     return <ErrorBanner message={error.message} />;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
          Listing Status Changes
        </h2>
        {changes.length > 0 && (
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {changes.length}
          </span>
        )}
      </div>

      {changes.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-gray-800 p-6 shadow-sm">
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">
            No listing changes detected yet. Run <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">npm run listing-checker</code> to populate.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-gray-800 p-4 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="pb-3 pr-4 text-left text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  Detected
                </th>
                <th className="pb-3 pr-4 text-left text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  Property
                </th>
                <th className="pb-3 pr-4 text-left text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  Agent
                </th>
                <th className="pb-3 pr-4 text-left text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  Change
                </th>
                <th className="pb-3 text-left text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  Link
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
