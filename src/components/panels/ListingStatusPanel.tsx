"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useListingChanges } from "@/hooks/useListingChanges";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { ListingChange, ChangeType } from "@/types/listing-status";
import type { MessageEdit } from "@/app/api/compose-message/route";

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

const LS_DISMISSED = "listing-dismissed";
const LS_EDITS     = "bnl-message-edits";
const MAX_EDITS_PER_TYPE = 5;

function useDismissed() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_DISMISSED);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

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
    // Keep only the most recent MAX_EDITS_PER_TYPE per changeType
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

// ── Fallback message composer (used before AI / when offline) ─────────────────

function fmt(p: number | null) {
  return p === null ? "—" : `$${p.toLocaleString()}`;
}

function fallbackMessage(c: ListingChange): string {
  const name = c.agentName.trim().split(" ")[0];
  const addr = c.address;
  switch (c.changeType) {
    case "sold":           return `Hi ${name}, congrats on closing ${addr}! 🎉`;
    case "pending":        return `Hi ${name}, congrats on getting ${addr} under contract!`;
    case "backup_offers":  return `Hi ${name}, congrats on ${addr} going under contract!`;
    case "back_on_market": return `Hi ${name}, congrats on ${addr} coming back on the market!`;
    case "price_change":   return `Hi ${name}, congrats on the price update on ${addr} to ${fmt(c.currentPrice)}!`;
    case "off_market":     return `Hi ${name}, congrats on ${addr}!`;
  }
}

// ── Send button ───────────────────────────────────────────────────────────────

type SendState = "idle" | "sending" | "sent" | "error";

function SendButton({
  change,
  message,
  originalMessage,
  onSent,
}: {
  change: ListingChange;
  message: string;
  originalMessage: string;
  onSent: () => void;
}) {
  const [state, setState] = useState<SendState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const phone = change.agentPhone;
  if (!phone) return <span className="text-xs text-gray-400 italic">No phone on file</span>;
  if (state === "sent")  return <span className="text-xs font-medium text-green-600">✓ Sent</span>;
  if (state === "error") return <span className="text-xs text-red-500" title={errorMsg}>✗ Failed — {errorMsg}</span>;

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

      // If the user edited the message, save the edit as a training example
      if (message.trim() !== originalMessage.trim()) {
        saveEdit({
          changeType:  change.changeType,
          original:    originalMessage,
          edited:      message,
        });
        onSent(); // notify parent to update edit count display
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Send failed");
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

// ── Change card ───────────────────────────────────────────────────────────────

function ChangeCard({
  change,
  onDismiss,
  onEditSaved,
}: {
  change: ListingChange;
  onDismiss: (id: string) => void;
  onEditSaved: () => void;
}) {
  const [open, setOpen]               = useState(false);
  const [message, setMessage]         = useState("");
  const [originalMsg, setOriginalMsg] = useState("");
  const [composing, setComposing]     = useState(false);
  const composedRef                   = useRef(false);

  // Compose message when the card is first opened
  useEffect(() => {
    if (!open || composedRef.current) return;
    composedRef.current = true;

    const base = fallbackMessage(change);
    setMessage(base);
    setOriginalMsg(base);

    const examples = loadEdits().filter((e) => e.changeType === change.changeType);
    if (examples.length === 0) return; // no examples yet — use fallback

    // Call Claude to generate an improved version
    setComposing(true);
    fetch("/api/compose-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changeType:   change.changeType,
        agentName:    change.agentName,
        address:      change.address + (change.address2 ? ` ${change.address2}` : ""),
        currentPrice: change.currentPrice,
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
  }, [open, change]);

  const isEdited = message.trim() !== originalMsg.trim();

  const shotDate = new Date(change.shotDate).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const statusDate = change.statusDate
    ? new Date(change.statusDate + "T12:00:00").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;
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
          <img src={change.photoUrl} alt={change.address} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">🏠</div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 pr-6">
        {/* Badge + status date */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[change.changeType]}`}>
            {CHANGE_LABELS[change.changeType]}
          </span>
          {statusDate && <span className="text-xs text-gray-500">on {statusDate}</span>}
          <span className="text-xs text-gray-300">· shot {shotDate}</span>
        </div>

        {/* Address */}
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
          {change.address}{change.address2 ? ` ${change.address2}` : ""}
        </p>
        <p className="text-xs text-gray-400 mb-1">
          {change.city}, {change.state} · {mlsText}
        </p>

        {/* Price delta */}
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

        {/* Links + toggle row */}
        <div className="mt-2 flex items-center gap-3">
          <a
            href={change.hdphUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            HD Photo Hub ↗
          </a>
          <a
            href={change.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Zillow ↗
          </a>
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs text-blue-500 hover:text-blue-700 underline"
          >
            {open ? "Hide message" : "Preview message"}
          </button>
        </div>

        {/* Editable message + send */}
        {open && (
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

            {/* Bottom row: edited indicator + char count + send */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isEdited && (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    ✏️ edited · will learn on send
                  </span>
                )}
                {!isEdited && !composing && loadEdits().filter(e => e.changeType === change.changeType).length > 0 && (
                  <span className="text-xs text-purple-400 flex items-center gap-1">
                    ✨ AI-improved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-300">{message.length} chars</span>
                <SendButton
                  change={change}
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

export function ListingStatusPanel() {
  const { changes, isLoading, error } = useListingChanges();
  const { dismissed, dismiss, restoreAll } = useDismissed();
  const [editCount, setEditCount] = useState(0);

  // Load edit count on mount (client only)
  useEffect(() => { setEditCount(countEdits()); }, []);

  const refreshEditCount = useCallback(() => setEditCount(countEdits()), []);

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error)     return <ErrorBanner message={error.message} />;

  const visible    = changes
    .filter((c) => !dismissed.has(c.id))
    .sort((a, b) =>
      new Date(a.shotDate ?? a.detectedAt).getTime() -
      new Date(b.shotDate ?? b.detectedAt).getTime()
    );
  const nDismissed = dismissed.size;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
          Listing Status Changes
        </h2>
        {visible.length > 0 && (
          <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {visible.length}
          </span>
        )}
        {editCount > 0 && (
          <span className="rounded-full bg-purple-100 dark:bg-purple-950 px-2.5 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-300" title="Claude learns from your edits to improve future messages">
            ✨ {editCount} example{editCount !== 1 ? "s" : ""} learned
          </span>
        )}
        {nDismissed > 0 && (
          <button onClick={restoreAll} className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline">
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
            <button onClick={restoreAll} className="text-blue-500 underline">Restore all</button>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <ChangeCard
              key={c.id}
              change={c}
              onDismiss={dismiss}
              onEditSaved={refreshEditCount}
            />
          ))}
        </div>
      )}
    </section>
  );
}
