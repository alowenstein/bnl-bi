"use client";

import { useMemo, useState } from "react";
import { useSites } from "@/hooks/useSites";
import { getAgentOnCameraSites, parseHdphDate } from "@/lib/data-transforms";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { HdphSite } from "@/types/hdph";

// ── Email modal ───────────────────────────────────────────────────────────────

interface EmailDraft {
  subject: string;
  htmlBody: string;
  textBody: string;
  to: string;
}

function EmailModal({ draft, onClose }: { draft: EmailDraft; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(draft.textBody).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">To: {draft.to}</p>
            <p className="font-semibold text-gray-800 text-sm">{draft.subject}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none mt-0.5"
          >
            ×
          </button>
        </div>

        {/* Email body */}
        <textarea
          readOnly
          value={draft.textBody}
          className="flex-1 resize-none font-mono text-xs text-gray-700 leading-relaxed p-6 bg-gray-50 overflow-y-auto outline-none"
        />

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
          <button
            onClick={handleCopy}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors min-w-[110px]"
          >
            {copied ? "Copied!" : "Copy Email"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function AocRow({ site }: { site: HdphSite }) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const date = parseHdphDate(site.created);
  const dateLabel = date
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const specs = [
    site.beds  ? `${site.beds}bd`                    : null,
    site.baths ? `${site.baths}ba`                   : null,
    site.sqft  ? `${site.sqft.toLocaleString()} sqft` : null,
  ].filter(Boolean).join(" · ");

  async function handleDraft() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/aoc-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: site.address,
          city: site.city,
          state: site.state,
          beds: site.beds,
          baths: site.baths,
          sqft: site.sqft,
          price: site.price,
          mls: site.mls,
          agentName: site.user.name,
          agentEmail: site.user.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setDraft(data as EmailDraft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50">
        <td className="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap">{dateLabel}</td>
        <td className="py-2 pr-3">
          <p className="font-medium text-gray-800 text-sm">{site.address}</p>
          <p className="text-xs text-gray-400">{site.city}, {site.state}</p>
        </td>
        <td className="py-2 pr-3">
          <p className="text-sm text-gray-700">{site.user.name}</p>
          <p className="text-xs text-gray-400">{site.user.email}</p>
        </td>
        <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{specs || "—"}</td>
        <td className="py-2">
          {err && <p className="text-xs text-red-500 mb-1">{err}</p>}
          <button
            onClick={handleDraft}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {loading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
                Generating…
              </>
            ) : (
              "Draft Email"
            )}
          </button>
        </td>
      </tr>
      {draft && <EmailModal draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function AgentOnCameraPanel() {
  const { sites, isLoading, error } = useSites();

  const aocSites = useMemo(() => getAgentOnCameraSites(sites), [sites]);

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error.message} />;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-800">Agent on Camera Orders</h2>
        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
          {aocSites.length}
        </span>
      </div>

      {aocSites.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No Agent on Camera orders found.</p>
      ) : (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-400">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-left font-medium">Address</th>
                  <th className="pb-2 text-left font-medium">Agent</th>
                  <th className="pb-2 text-left font-medium">Specs</th>
                  <th className="pb-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {aocSites.map((site) => (
                  <AocRow key={site.sid} site={site} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
