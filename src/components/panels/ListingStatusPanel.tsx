"use client";

import { useState, useEffect, useCallback } from "react";
import { useListingChanges } from "@/hooks/useListingChanges";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { ListingChange, ChangeType } from "@/types/listing-status";

// ── Labels & styles ───────────────────────────────────────────────────────────

const CHANGE_LABELS: Record<ChangeType, string> = {
  sold:           "Sold",
  pending:        "Pending / Under Contract",
  backup_offers:  "Accepting Backup Offers",
  price_change:   "Price Change",
  back_on_market: "Back on Market",
  off_market:     "Off Market",
};

const BADGE_CLASSES: Record<ChangeType, string> = {
  sold:           "bg-green-100  text-green-700",
  pending:        "bg-yellow-100 text-yellow-700",
  backup_offers:  "bg-orange-100 text-orange-700",
  price_change:   "bg-blue-100   text-blue-700",
  back_on_market: "bg-purple-100 text-purple-700",
  off_market:     "bg-gray-100   text-gray-600",
};

// ── Dismissed IDs (localStorage) ──────────────────────────────────────────────

const LS_KEY = "listing-dismissed";

function useDismissed() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Load from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setDismissed(new Set());
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  return { dismissed, dismiss, restoreAll };
}

// ── Message composer ──────────────────────────────────────────────────────────

function firstName(full: string) {
  return full.split(" ")[0];
}

function fmt(p: number | null) {
  return p === null ? "—" : `$${p.toLocaleString()}`;
}

function composeMessage(c: ListingChange): string {
  const name = firstName(c.agentName);
  const addr = c.address;

  switch (c.changeType) {
    case "sold":
      return `Hi ${name}, congrats on closing ${addr}! 🎉`;
    case "pending":
      return `Hi ${name}, congrats on getting ${addr} under contract!`;
    case "backup_offers":
      return `Hi ${name}, congrats on ${addr} going under contract!`;
    case "back_on_market":
      return `Hi ${name}, congrats on ${addr} coming back on the market!`;
    case "price_change": {
      const newPrice = fmt(c.currentPrice);
      return `Hi ${name}, congrats on the price update on ${addr} to ${newPrice}!`;
    }
    case "off_market":
      return `Hi ${name}, congrats on ${addr}!`;
  }
}

// ── Send button ───────────────────────────────────────────────────────────────

type SendState = "idle" | "sending" | "sent" | "error";

function SendButton({ change, message }: { change: ListingChange; message: string }) {
  const [state, setState] = useState<SendState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const phone = change.agentPhone;
  const hasPhone = !!phone;

  async function handleSend() {
    if (!hasPhone) return;
    setState("sending");
    try {
      const res = await fetch("/api/openphone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, content: message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setState("sent");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Send failed");
      setState("error");
    }
  }

  if (!hasPhone) return <span className="text-xs text-gray-400 italic">No phone on file</span>;
  if (state === "sent")  return <span className="text-xs font-medium text-green-600">✓ Sent</span>;
  if (state === "error") return <span className="text-xs text-red-500" title={errorMsg}>✗ Failed</span>;

  return (
    <button
      onClick={handleSend}
      disabled={state === "sending"}
      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
    >
      {state === "sending" ? "Sending…" : "Send via Quo"}
    </button>
  );
}

// ── Change card ───────────────────────────────────────────────────────────────

function ChangeCard({
  change,
  onDismiss,
}: {
  change: ListingChange;
  onDismiss: (id: string) => void;
}) {
  const [msgOpen, setMsgOpen] = useState(false);
  const message = composeMessage(change);

  const date = new Date(change.detectedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const mlsText = change.mls ? `MLS# ${change.mls}` : "No MLS#";
  const isPriceChange = change.changeType === "price_change";

  return (
    <div className="relative flex gap-4 rounded-xl bg-white dark:bg-gray-800 p-4 shadow-sm">
      {/* Dismiss button */}
      <button
        onClick={() => onDismiss(change.id)}
        title="Dismiss"
        className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-700 transition-colors text-base leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>

      {/* Listing photo */}
      <div className="flex-none w-24 h-24 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
        {change.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={change.photoUrl}
            alt={change.address}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">
            🏠
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 pr-6">
        {/* Top row: date + badge */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-400">{date}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[change.changeType]}`}>
            {CHANGE_LABELS[change.changeType]}
          </span>
        </div>

        {/* Address */}
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
          {change.address}{change.address2 ? ` ${change.address2}` : ""}
        </p>
        <p className="text-xs text-gray-400 mb-1">
          {change.city}, {change.state} · {mlsText}
        </p>

        {/* Price delta (price_change only) */}
        {isPriceChange && change.priceDelta !== null && (
          <p className="text-xs text-gray-500 mb-1">
            {fmt(change.previousPrice)} → <strong>{fmt(change.currentPrice)}</strong>
            <span className={`ml-1 font-semibold ${change.priceDelta < 0 ? "text-blue-600" : "text-red-600"}`}>
              ({change.priceDelta < 0 ? "▼" : "▲"} ${Math.abs(change.priceDelta).toLocaleString()})
            </span>
          </p>
        )}

        {/* Agent */}
        <p className="text-xs text-gray-500">
          {change.agentName}
          {change.agentPhone && <span className="ml-1 text-gray-400">· {change.agentPhone}</span>}
        </p>

        {/* Links row */}
        <div className="mt-2 flex items-center gap-3">
          <a
            href={change.hdphUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            HD Photo Hub ↗
          </a>
          <button
            onClick={() => setMsgOpen((o) => !o)}
            className="text-xs text-blue-500 hover:text-blue-700 underline"
          >
            {msgOpen ? "Hide message" : "Preview message"}
          </button>
        </div>

        {msgOpen && (
          <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-700 p-3 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
            {message}
          </div>
        )}
      </div>

      {/* Send button */}
      <div className="flex-none flex items-start pt-1">
        {msgOpen && <SendButton change={change} message={message} />}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ListingStatusPanel() {
  const { changes, isLoading, error } = useListingChanges();
  const { dismissed, dismiss, restoreAll } = useDismissed();

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error)     return <ErrorBanner message={error.message} />;

  const visible = changes
    .filter((c) => !dismissed.has(c.id))
    .sort((a, b) => new Date(a.shotDate ?? a.detectedAt).getTime() - new Date(b.shotDate ?? b.detectedAt).getTime());
  const nDismissed = dismissed.size;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
          Listing Status Changes
        </h2>
        {visible.length > 0 && (
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {visible.length}
          </span>
        )}
        {nDismissed > 0 && (
          <button
            onClick={restoreAll}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Show {nDismissed} dismissed
          </button>
        )}
      </div>

      {visible.length === 0 && nDismissed === 0 ? (
        <div className="rounded-xl bg-white dark:bg-gray-800 p-6 shadow-sm">
          <p className="text-sm text-gray-400 italic">
            No listing changes detected yet. Run{" "}
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">
              npm run listing-checker
            </code>{" "}
            to populate.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-gray-800 p-6 shadow-sm">
          <p className="text-sm text-gray-400 italic">
            All listings dismissed.{" "}
            <button onClick={restoreAll} className="text-blue-500 underline">
              Restore all
            </button>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <ChangeCard key={c.id} change={c} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </section>
  );
}
