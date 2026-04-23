import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";
import type { HdphSite } from "@/types/hdph";

function isTodayAZ(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric", month: "numeric", day: "numeric",
  });
  return fmt.format(d) === fmt.format(new Date());
}

// Returns the earliest non-canceled appointment date for a site, or null
function apptDate(site: HdphSite): string | null {
  const tasks = site.tasks ?? [];
  const dates = tasks
    .filter((t) => !t.canceled && t.apptdate)
    .map((t) => t.apptdate as string)
    .sort();
  return dates[0] ?? null;
}

export async function GET() {
  try {
    const sites = await hdphFetch<HdphSite[]>("/sites");
    const today = sites
      .filter((s) => {
        const appt = apptDate(s);
        // Prefer appointment date from tasks; fall back to booking date
        return isTodayAZ(appt ?? s.created);
      })
      .sort((a, b) => {
        const da = new Date(apptDate(a) ?? a.created).getTime();
        const db = new Date(apptDate(b) ?? b.created).getTime();
        return da - db;
      });
    return NextResponse.json(today);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
