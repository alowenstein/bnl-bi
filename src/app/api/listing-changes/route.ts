/**
 * GET /api/listing-changes
 *
 * Reads the latest scan results from Vercel KV (written by the /refresh route).
 * Returns instantly — no HDPH or RealtyAPI calls happen here.
 */

import { NextResponse } from "next/server";
import type { ListingEntry } from "@/types/listing-status";

const KV_URL   = process.env.KV_REST_API_URL  ?? "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN ?? "";
const KV_KEY   = "listing:results";

interface KVStore { listings: ListingEntry[]; savedAt: number }

export async function GET() {
  if (!KV_URL || !KV_TOKEN) {
    return NextResponse.json(
      { listings: [], savedAt: null, empty: true, reason: "KV not configured" },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(`${KV_URL}/get/${KV_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV ${res.status}`);

    const { result } = await res.json() as { result: string | null };
    if (!result) {
      return NextResponse.json({ listings: [], savedAt: null, empty: true });
    }

    const store = JSON.parse(result) as KVStore;
    return NextResponse.json({
      listings: store.listings,
      savedAt:  new Date(store.savedAt).toISOString(),
      empty:    false,
    });
  } catch {
    return NextResponse.json({ listings: [], savedAt: null, empty: true });
  }
}
