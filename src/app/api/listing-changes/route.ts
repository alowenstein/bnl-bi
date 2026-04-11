import { NextResponse } from "next/server";
import { loadChangeLog } from "@/lib/listing-store";
import type { ListingChange } from "@/types/listing-status";

/**
 * A status change is only relevant if it happened AFTER the photo shoot.
 * If statusDate predates shotDate, Zillow is showing an old event from
 * before we ever photographed the property — not actionable for outreach.
 * When statusDate is unknown (null), we give it the benefit of the doubt.
 */
function isRelevant(c: ListingChange): boolean {
  if (!c.statusDate || !c.shotDate) return true; // can't determine — keep
  const statusMs = new Date(c.statusDate).getTime();
  const shotMs   = new Date(c.shotDate).getTime();
  return statusMs >= shotMs;
}

/** Keep only the most recent change per listing (by sid). */
function latestPerListing(changes: ListingChange[]): ListingChange[] {
  const byDate = (c: ListingChange) =>
    new Date(c.statusDate ?? c.detectedAt).getTime();

  const map = new Map<number, ListingChange>();
  for (const c of changes.filter(isRelevant)) {
    const existing = map.get(c.sid);
    if (!existing || byDate(c) > byDate(existing)) {
      map.set(c.sid, c);
    }
  }
  return [...map.values()];
}

export async function GET() {
  try {
    const store = await loadChangeLog();
    const changes = latestPerListing(store.changes);
    return NextResponse.json({ changes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
