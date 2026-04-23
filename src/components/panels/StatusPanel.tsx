"use client";

import { useState } from "react";
import useSWR from "swr";
import type { HdphSite } from "@/types/hdph";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type SendState = "idle" | "sending" | "sent" | "error";

function formatAddress(site: HdphSite) {
  return [site.address, site.city, site.state].filter(Boolean).join(", ");
}

function formatTime(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix",
  });
}

function apptDate(site: HdphSite) {
  const dates = (site.tasks ?? [])
    .filter((t) => !t.canceled && t.apptdate)
    .map((t) => t.apptdate as string)
    .sort();
  return dates[0] ?? null;
}

function JobCard({ site }: { site: HdphSite }) {
  const [onWayState,  setOnWayState]  = useState<SendState>("idle");
  const [headingState, setHeadingState] = useState<SendState>("idle");

  const agent = site.user;
  const agentPhone = agent?.phone ?? "";
  const agentFirst = agent?.firstname || agent?.name || "there";
  const photographer = site.member?.name || site.member?.firstname
    ? `${site.member.firstname ?? ""} ${site.member.lastname ?? ""}`.trim()
    : null;
  const address = formatAddress(site);

  async function send(
    type: "onway" | "heading",
    setState: (s: SendState) => void,
  ) {
    if (!agentPhone) return;
    setState("sending");
    const content =
      type === "onway"
        ? `Hi ${agentFirst}! ${photographer ?? "Your photographer"} from Builds 'n Lenses here. I'm on my way to ${address} and should arrive shortly! 🚗`
        : `Hi ${agentFirst}! All wrapped up at ${address}. Heading out now — your photos will be delivered within 24 hours. Thanks! 🏡`;
    try {
      const res = await fetch("/api/openphone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: agentPhone, content }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm space-y-3">
      <div>
        <p className="font-semibold text-gray-900">{address}</p>
        {formatTime(apptDate(site)) && (
          <p className="text-sm text-gray-500">{formatTime(apptDate(site))}</p>
        )}
      </div>

      <div className="text-sm space-y-0.5">
        <p><span className="text-gray-400">Agent:</span> <span className="text-gray-800">{agent?.name || "—"}</span></p>
        <p><span className="text-gray-400">Photographer:</span> <span className="text-gray-800">{photographer ?? "—"}</span></p>
        {!agentPhone && (
          <p className="text-amber-600 text-xs mt-1">No phone number on file for this agent</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <SmsButton
          label="On My Way 🚗"
          state={onWayState}
          disabled={!agentPhone}
          color="blue"
          onClick={() => send("onway", setOnWayState)}
        />
        <SmsButton
          label="Heading Out 🏁"
          state={headingState}
          disabled={!agentPhone}
          color="green"
          onClick={() => send("heading", setHeadingState)}
        />
      </div>
    </div>
  );
}

function SmsButton({
  label, state, disabled, color, onClick,
}: {
  label: string;
  state: SendState;
  disabled: boolean;
  color: "blue" | "green";
  onClick: () => void;
}) {
  const base = "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40";
  const colors = {
    blue:  "bg-blue-600  hover:bg-blue-700  text-white",
    green: "bg-green-600 hover:bg-green-700 text-white",
  };
  const display =
    state === "sending" ? "Sending…" :
    state === "sent"    ? "Sent ✓" :
    state === "error"   ? "Failed ✗" :
    label;

  return (
    <button
      onClick={onClick}
      disabled={disabled || state === "sending"}
      className={`${base} ${colors[color]}`}
    >
      {display}
    </button>
  );
}

export function StatusPanel() {
  const { data: sites, isLoading, error } = useSWR<HdphSite[]>(
    "/api/hdph/today",
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  );

  if (isLoading) return <LoadingSpinner size="lg" />;
  if (error)     return <ErrorBanner message={error.message} />;

  if (!sites?.length) {
    return (
      <div className="rounded-xl bg-white p-8 shadow-sm text-center text-gray-400">
        No jobs scheduled for today.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {sites.length} job{sites.length !== 1 ? "s" : ""} today
      </p>
      {sites.map((site) => (
        <JobCard key={site.sid} site={site} />
      ))}
    </div>
  );
}
