import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";
import type { HdphSite } from "@/types/hdph";

function isTodayAZ(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric", month: "numeric", day: "numeric",
  });
  return fmt.format(d) === fmt.format(new Date());
}

export async function GET() {
  try {
    const sites = await hdphFetch<HdphSite[]>("/sites");
    const today = sites
      .filter((s) => isTodayAZ(s.created))
      .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    return NextResponse.json(today);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
