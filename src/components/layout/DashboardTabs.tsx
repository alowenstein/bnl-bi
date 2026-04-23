"use client";

import { useState } from "react";

type Tab = "analytics" | "tracker" | "status";

interface Props {
  analytics: React.ReactNode;
  tracker:   React.ReactNode;
  status:    React.ReactNode;
}

export function DashboardTabs({ analytics, tracker, status }: Props) {
  const [active, setActive] = useState<Tab>("analytics");

  return (
    <div>
      <div className="mb-8 flex gap-1 border-b border-gray-200">
        <TabButton label="Analytics"       id="analytics" active={active} onClick={setActive} />
        <TabButton label="Listing Tracker" id="tracker"   active={active} onClick={setActive} />
        <TabButton label="On My Way"       id="status"    active={active} onClick={setActive} />
      </div>

      {active === "analytics" && analytics}
      {active === "tracker"   && tracker}
      {active === "status"    && status}
    </div>
  );
}

function TabButton({
  label, id, active, onClick,
}: {
  label: string;
  id: Tab;
  active: Tab;
  onClick: (id: Tab) => void;
}) {
  const isActive = id === active;
  return (
    <button
      onClick={() => onClick(id)}
      className={[
        "px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
        isActive
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
