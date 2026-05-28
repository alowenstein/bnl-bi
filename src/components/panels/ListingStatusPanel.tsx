"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useListingChanges } from "@/hooks/useListingChanges";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { ListingEntry, DisplayStatus } from "@/types/listing-status";
import type { MessageEdit } from "@/app/api/compose-message/route";
import { streetName } from "@/lib/listing-utils";

// ── Labels & styles ───────────────────────────────────────────────────────────

const LABELS: Record<DisplayStatus, string> = {
  for_sale:     "For Sale",
  price_change: "Price Change",
  pending:      "Pending",
  backup_offers:"Accepting Backup Offers",
  sold:         "Sold",
  off_market:   "Off Market",
};

const BADGE: Record<DisplayStatus, string> = {
  for_sale:     "bg-gray-100  text-gray-600",
  price_change: "bg-blue-100  text-blue-700",
  pending:      "bg-yellow-100 text-yellow-700",
  backup_offers:"bg-orange-100 text-orange-700",
  sold:         "bg-green-100  text-green-700",
  off_market:   "bg-gray-100   text-gray-500",
};

// ── Dismissed IDs (localStorage) ──────────────────────────────────────────────

const LS_DISMISSED = "listing-dismissed";
const LS_EDITS     = "bnl-message-edits";
const MAX_EDITS_PER_TYPE = 5;

function useDismissed() {
  // Lazy initializer reads localStorage synchronously on first render so
  // dismissed IDs are known before SWR data arrives — no flash of dismissed cards.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_DISMISSED);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(LS_DISMISSED, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setDismissed(new Set());
    try { localStorage.removeItem(LS_DISMISSED); } catch { /* ignore */ }
  }, []);

  return { dismissed, dismiss, restoreAll };
}

// ── Message edit examples (localStorage) ──────────────────────────────────────

function loadEdits(): MessageEdit[] {
  try {
    const raw = localStorage.getItem(LS_EDITS);
    return raw ? (JSON.parse(raw) as MessageEdit[]) : [];
  } catch { return []; }
}

function saveEdit(edit: Omit<MessageEdit, "savedAt">) {
  try {
    const existing = loadEdits();
    const filtered = existing.filter((e) => e.changeType !== edit.changeType);
    const sameType = existing.filter((e) => e.changeType === edit.changeType);
    const updated: MessageEdit[] = [
      ...filtered,
      ...sameType.slice(-(MAX_EDITS_PER_TYPE - 1)),
      { ...edit, savedAt: new Date().toISOString() },
    ];
    localStorage.setItem(LS_EDITS, JSON.stringify(updated));
  } catch { /* ignore */ }
}

function countEdits(): number {
  return loadEdits().length;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(p: number | null) {
  return p === null ? "—" : `$${p.toLocaleString()}`;
}


function fallbackMessage(entry: ListingEntry): string {
  const name   = entry.agentName.trim().split(" ")[0];
  const street = streetName(entry.address);
  switch (entry.displayStatus) {
    case "sold":           return `Congrats on closing ${street}, ${name}!`;
    case "pending":        return `${name}, congrats on getting ${street} under contract!`;
    case "backup_offers":  return `${name}, congrats on ${street} going under contract!`;
    case "price_change":   return `${name}, saw the price update on ${street} — might be worth swapping the hero photo on Zillow to give it a fresh look for buyers at the new price.`;
    case "off_market":     return `${name}, hope everything's going well with ${street}!`;
    default:               return `Hey ${name}, just checking in on ${street}.`;
  }
}

// ── Send button ───────────────────────────────────────────────────────────────

type SendState = "idle" | "sending" | "sent" | "error";

function SendButton({
  entry,
  message,
  originalMessage,
  onSent,
}: {
  entry: ListingEntry;
  message: string;
  originalMessage: string;
  onSent: () => void;
}) {
  const [state, setState] = useState<SendState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const phone = entry.agentPhone;
  if (!phone) return <span className="text-xs text-gray-400 italic">No phone on file</span>;
  if (state === "sent")  return <span className="text-xs font-medium text-green-600">✓ Sent</span>;
  if (state === "error") return <span className="text-xs text-red-500">✗ {errorMsg}</span>;

  async function handleSend() {
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

      // If the user edited the message, save it as a training example
      if (message.trim() !== originalMessage.trim()) {
        saveEdit({
          changeType: entry.displayStatus,
          original:   originalMessage,
          edited:     message,
        });
        onSent();
      }
    } catch (err) {
      console.error("Send failed:", err);
      setErrorMsg("Send failed — check phone number and try again.");
      setState("error");
    }
  }

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

// ── Listing card ──────────────────────────────────────────────────────────────

function ListingCard({
  entry,
  onDismiss,
  onEditSaved,
}: {
  entry: ListingEntry;
  onDismiss: (id: string) => void;
  onEditSaved: () => void;
}) {
  const isNoteworthy = entry.displayStatus !== "for_sale";

  const [open, setOpen]               = useState(false);
  const [message, setMessage]         = useState("");
  const [originalMsg, setOriginalMsg] = useState("");
  const [composing, setComposing]     = useState(false);
  const composedRef                   = useRef(false);

  // Compose message when the card is first opened
  useEffect(() => {
    if (!open || composedRef.current) return;
    composedRef.current = true;

    const base = fallbackMessage(entry);
    setMessage(base);
    setOriginalMsg(base);

    const examples = loadEdits().filter((e) => e.changeType === entry.displayStatus);
    if (examples.length === 0) return;

    setComposing(true);
    fetch("/api/compose-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changeType:   entry.displayStatus,
        agentName:    entry.agentName,
        address:      entry.address + (entry.address2 ? ` ${entry.address2}` : ""),
        currentPrice: entry.currentPrice,
        examples,
      }),
    })
      .then((r) => r.json())
      .then((data: { message?: string }) => {
        if (data.message) {
          setMessage(data.message);
          setOriginalMsg(data.message);
        }
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => setComposing(false));
  }, [open, entry]);

  const isEdited = message.trim() !== originalMsg.trim();

  const shotDate = new Date(entry.shotDate).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const statusDate = entry.statusDate
    ? new Date(entry.statusDate + "T12:00:00").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  const isPriceChange = entry.displayStatus === "price_change";
  const priceDelta    = isPriceChange && entry.currentPrice !== null && entry.previousPrice !== null
    ? entry.currentPrice - entry.previousPrice
    : null;

  return (
    <div className="relative flex gap-4 rounded-xl bg-white dark:bg-gray-800 p-4 shadow-sm">
      {/* Dismiss button */}
      <button
        onClick={() => onDismiss(entry.id)}
        title="Dismiss"
        className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-700 transition-colors text-base leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>

      {/* Listing photo */}
      <div className="flex-none w-24 h-24 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
        {entry.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.photoUrl} alt={entry.address} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">🏠</div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 pr-6">
        {/* Badge + status date */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[entry.displayStatus]}`}>
            {LABELS[entry.displayStatus]}
          </span>
          {statusDate && <span className="text-xs text-gray-500">on {statusDate}</span>}
          <span className="text-xs text-gray-300">· shot {shotDate}</span>
        </div>

        {/* Address */}
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
          {entry.address}{entry.address2 ? ` ${entry.address2}` : ""}
        </p>
        <p className="text-xs text-gray-400 mb-1">
          {entry.city}, {entry.state}
          {entry.mls && <span> · MLS# {entry.mls}</span>}
        </p>

        {/* Price info */}
        {isPriceChange ? (
          <p className="text-xs text-gray-500 mb-1">
            {fmt(entry.previousPrice)} → <strong>{fmt(entry.currentPrice)}</strong>
            {priceDelta !== null && (
              <span className={`ml-1 font-semibold ${priceDelta < 0 ? "text-blue-600" : "text-red-600"}`}>
                ({priceDelta < 0 ? "▼" : "▲"} ${Math.abs(priceDelta).toLocaleString()})
              </span>
            )}
          </p>
        ) : entry.currentPrice !== null ? (
          <p className="text-xs text-gray-500 mb-1">{fmt(entry.currentPrice)}</p>
        ) : null}

        {/* Agent */}
        <p className="text-xs text-gray-500">
          {entry.agentName}
          {entry.agentPhone && <span className="ml-1 text-gray-400">· {entry.agentPhone}</span>}
        </p>

        {/* Links + message toggle */}
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <a
            href={entry.hdphUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            HD Photo Hub ↗
          </a>
          <a
            href={entry.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Zillow ↗
          </a>
          {isNoteworthy && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-xs text-blue-500 hover:text-blue-700 underline"
            >
              {open ? "Hide message" : "Preview message"}
            </button>
          )}
        </div>

        {/* Compose + send — noteworthy only */}
        {isNoteworthy && open && (
          <div className="mt-3 space-y-2">
            <div className="relative">
              {composing && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70 dark:bg-gray-800/70 z-10">
                  <span className="text-xs text-gray-400 flex items-center gap-1.5">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Composing…
                  </span>
                </div>
              )}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isEdited && (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    ✏️ edited · will learn on send
                  </span>
                )}
                {!isEdited && !composing && loadEdits().filter(e => e.changeType === entry.displayStatus).length > 0 && (
                  <span className="text-xs text-purple-400 flex items-center gap-1">
                    ✨ AI-improved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-300">{message.length} chars</span>
                <SendButton
                  entry={entry}
                  message={message}
                  originalMessage={originalMsg}
                  onSent={onEditSaved}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

type View = "noteworthy" | "for_sale";

// Filter chips shown in the noteworthy view, in display order
const FILTER_CHIPS: { status: DisplayStatus; label: string; active: string; inactive: string }[] = [
  { status: "sold",          label: "Sold",           active: "bg-green-600 text-white",  inactive: "bg-green-50 text-green-700 hover:bg-green-100" },
  { status: "pending",       label: "Pending",         active: "bg-yellow-500 text-white", inactive: "bg-yellow-50 text-yellow-700 hover:bg-yellow-100" },
  { status: "backup_offers", label: "Backup Offers",   active: "bg-orange-500 text-white", inactive: "bg-orange-50 text-orange-700 hover:bg-orange-100" },
  { status: "price_change",  label: "Price Change",    active: "bg-blue-600 text-white",   inactive: "bg-blue-50 text-blue-700 hover:bg-blue-100" },
  { status: "off_market",    label: "Off Market",      active: "bg-gray-600 text-white",   inactive: "bg-gray-100 text-gray-600 hover:bg-gray-200" },
];

export function ListingStatusPanel() {
  const { listings, isLoading, error, refresh, fetchedAt, cached } = useListingChanges();
  const { dismissed, dismiss, restoreAll } = useDismissed();
  const [editCount, setEditCount]       = useState(0);
  const [refreshing, setRefreshing]     = useState(false);
  const [view, setView]                 = useState<View>("noteworthy");
  const [statusFilter, setStatusFilter] = useState<DisplayStatus | "all">("all");

  useEffect(() => { setEditCount(countEdits()); }, []);

  const refreshEditCount = useCallback(() => setEditCount(countEdits()), []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 6000);
  }, [refresh]);

  const handleToggleView = useCallback(() => {
    setView((v) => v === "noteworthy" ? "for_sale" : "noteworthy");
    setStatusFilter("all");
  }, []);

  const fetchedAgo = fetchedAt
    ? (() => {
        const mins = Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000);
        if (mins < 1) return "just now";
        if (mins === 1) return "1 min ago";
        return `${mins} min ago`;
      })()
    : null;

  if (isLoading) return (
    <div className="flex flex-col items-center gap-3 py-12 text-gray-400">
      <LoadingSpinner size="lg" />
      <p className="text-sm">Checking 90-day listings via Zillow…</p>
    </div>
  );
  if (error) return <ErrorBanner message={error.message} />;

  // Partition into noteworthy vs. for sale, then apply status filter
  const noteworthy = listings.filter((l) => l.displayStatus !== "for_sale");
  const forSale    = listings.filter((l) => l.displayStatus === "for_sale");
  const pool       = view === "noteworthy"
    ? (statusFilter === "all" ? noteworthy : noteworthy.filter((l) => l.displayStatus === statusFilter))
    : forSale;
  const visible    = pool.filter((l) => !dismissed.has(l.id));
  const nDismissed = pool.filter((l) =>  dismissed.has(l.id)).length;

  // Count per status for chip labels
  const statusCounts = noteworthy.reduce<Partial<Record<DisplayStatus, number>>>((acc, l) => {
    acc[l.displayStatus] = (acc[l.displayStatus] ?? 0) + 1;
    return acc;
  }, {});

  const toggleLabel = view === "noteworthy"
    ? `Show For Sale (${forSale.length})`
    : `Show Status Changes (${noteworthy.length})`;

  return (
    <section className="space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
          {view === "noteworthy" ? "Listing Status Changes" : "For Sale Portfolio"}
        </h2>
        {visible.length > 0 && (
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {visible.length}
          </span>
        )}
        {editCount > 0 && (
          <span
            className="rounded-full bg-purple-100 dark:bg-purple-950 px-2.5 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-300"
            title="Claude learns from your edits to improve future messages"
          >
            ✨ {editCount} example{editCount !== 1 ? "s" : ""} learned
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Toggle view */}
          <button
            onClick={handleToggleView}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {toggleLabel}
          </button>

          {/* Freshness */}
          {fetchedAgo && (
            <span className="text-xs text-gray-400" title={fetchedAt ?? ""}>
              {cached ? "cached" : "live"} · {fetchedAgo}
            </span>
          )}

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <span className={refreshing ? "animate-spin inline-block" : "inline-block"}>↻</span>
            {refreshing ? "Checking…" : "Refresh"}
          </button>

          {/* Restore dismissed */}
          {nDismissed > 0 && (
            <button onClick={restoreAll} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Show {nDismissed} dismissed
            </button>
          )}
        </div>
      </div>

      {/* Status filter chips — only in noteworthy view when >1 type present */}
      {view === "noteworthy" && Object.keys(statusCounts).length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStatusFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === "all"
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All ({noteworthy.length})
          </button>
          {FILTER_CHIPS.filter((c) => (statusCounts[c.status] ?? 0) > 0).map((c) => (
            <button
              key={c.status}
              onClick={() => setStatusFilter(statusFilter === c.status ? "all" : c.status)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === c.status ? c.active : c.inactive
              }`}
            >
              {c.label} ({statusCounts[c.status]})
            </button>
          ))}
        </div>
      )}

      {/* Cards */}
      {visible.length === 0 && nDismissed === 0 ? (
        <div className="rounded-xl bg-white dark:bg-gray-800 p-6 shadow-sm">
          <p className="text-sm text-gray-400 italic">
            {view === "noteworthy"
              ? "No listings in a noteworthy state in the last 90 days. All good!"
              : "No for-sale listings found in the last 90 days."}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-gray-800 p-6 shadow-sm">
          <p className="text-sm text-gray-400 italic">
            All listings dismissed.{" "}
            <button onClick={restoreAll} className="text-blue-500 underline">Restore all</button>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {visible.map((entry) => (
            <ListingCard
              key={entry.id}
              entry={entry}
              onDismiss={dismiss}
              onEditSaved={refreshEditCount}
            />
          ))}
        </div>
      )}
    </section>
  );
}
