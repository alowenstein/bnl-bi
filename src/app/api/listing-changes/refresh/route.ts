/**
 * GET /api/listing-changes/refresh
 *
 * Runs the full HDPH + RealtyAPI scan and writes slim results to KV.
 * Called by Vercel Cron (hourly) and by the dashboard Refresh button.
 *
 * Saves to KV incrementally after each batch of 30 so that even a
 * Hobby-plan 10s timeout leaves partial data in KV for the UI to show.
 */

import { NextResponse } from "next/server";
import type { ListingEntry } from "@/types/listing-status";
import {
  mapZillowStatus, getStatusDate, determineListing, getFirstPhotoUrl,
  type HdphSite, type RealtyApiResult, type PriceHistoryEntry,
} from "@/lib/listing-utils";

export const maxDuration = 60;

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE             = process.env.HDPH_BASE_URL ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY              = process.env.HDPH_API_KEY  ?? "";
const REALTYAPI_KEY         = process.env.REALTYAPI_KEY ?? "";
const REALTYAPI_BASE        = "https://zillow.realtyapi.io";
const KV_URL                = process.env.KV_REST_API_URL  ?? "";
const KV_TOKEN              = process.env.KV_REST_API_TOKEN ?? "";
export const KV_KEY         = "listing:results";
const WINDOW_DAYS           = 90;
const REALTYAPI_CONCURRENCY = 30;
const REALTYAPI_TIMEOUT_MS  = 5_000;
const BROWSER_UA            =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── KV ────────────────────────────────────────────────────────────────────────

async function kvSet(listings: ListingEntry[]): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  const payload = JSON.stringify({ listings, savedAt: Date.now() });
  await fetch(`${KV_URL}/set/${KV_KEY}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value: payload }),
  });
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      try   { results[idx] = { status: "fulfilled", value: await tasks[idx]() }; }
      catch (reason) { results[idx] = { status: "rejected", reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ── HDPH ──────────────────────────────────────────────────────────────────────

async function fetchHdphSites(): Promise<HdphSite[]> {
  const res = await fetch(`${HDPH_BASE}/sites`, {
    headers: { api_key: HDPH_KEY, "User-Agent": BROWSER_UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HDPH ${res.status}`);

  let text = await res.text();
  const htmlIdx = text.indexOf("<font");
  if (htmlIdx !== -1) {
    const before  = text.slice(0, htmlIdx);
    const lastEnd = Math.max(before.lastIndexOf("}]},"), before.lastIndexOf("}]},\r"));
    text = lastEnd !== -1
      ? before.slice(0, lastEnd + 3) + "]"
      : before.slice(0, before.lastIndexOf("}") + 1) + "]";
  }
  return JSON.parse(text) as HdphSite[];
}

function withinWindow(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && d.getTime() >= Date.now() - days * 86_400_000;
}

// ── RealtyAPI ─────────────────────────────────────────────────────────────────

async function fetchRealtyApiStatus(site: HdphSite): Promise<RealtyApiResult | null> {
  const fullAddress = [site.address, site.address2, site.city, site.state, site.zip]
    .filter(Boolean).join(" ");
  const url = `${REALTYAPI_BASE}/pro/byaddress?propertyaddress=${encodeURIComponent(fullAddress)}`;
  try {
    const res = await fetch(url, {
      headers: { "x-realtyapi-key": REALTYAPI_KEY, "User-Agent": BROWSER_UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REALTYAPI_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const json = await res.json() as { propertyDetails?: Record<string, unknown> };
    const pd = json.propertyDetails;
    if (!pd?.homeStatus) return null;

    const status = mapZillowStatus(
      pd.homeStatus as string,
      pd.listingSubType as Record<string, boolean> | null,
      pd.contingentListingType as string | null,
    );
    const rawHistory = ((pd.priceHistory as PriceHistoryEntry[] | null) ?? [])
      .filter((h) => !h.postingIsRental);
    const price      = (pd.price as number | null) ?? null;
    const listingUrl = pd.hdpUrl
      ? `https://www.zillow.com${pd.hdpUrl as string}`
      : `https://www.zillow.com/homes/${encodeURIComponent(fullAddress.replace(/\s+/g, "-"))}_rb/`;
    const statusDate = getStatusDate(rawHistory, status);
    const photoUrl   = (pd.hiResImageLink as string | null) ?? null;

    return { status, price, listingUrl, statusDate, photoUrl, priceHistory: rawHistory };
  } catch { return null; }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  if (!HDPH_KEY || !REALTYAPI_KEY) {
    return NextResponse.json({ error: "Missing API credentials" }, { status: 503 });
  }

  const allSites = await fetchHdphSites();
  const sites    = allSites.filter(
    (s) => withinWindow(s.created, WINDOW_DAYS) &&
           s.media?.some((m) => m.type === "still" && !m.hidden)
  );

  const listings: ListingEntry[] = [];

  // Process in batches, saving to KV after each — partial progress survives a timeout
  for (let i = 0; i < sites.length; i += REALTYAPI_CONCURRENCY) {
    const batch   = sites.slice(i, i + REALTYAPI_CONCURRENCY);
    const results = await pLimit(
      batch.map((site) => () => fetchRealtyApiStatus(site)),
      REALTYAPI_CONCURRENCY,
    );

    for (let j = 0; j < batch.length; j++) {
      const site   = batch[j];
      const result = results[j];
      if (result.status !== "fulfilled" || !result.value) continue;

      const hdphUrl = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;
      const enriched: RealtyApiResult = {
        ...result.value,
        photoUrl: getFirstPhotoUrl(site) ?? result.value.photoUrl,
      };
      const entry = determineListing(site, enriched, hdphUrl);
      if (entry) listings.push(entry);
    }

    // Save partial results after each batch so a timeout still yields data
    await kvSet(listings);
  }

  listings.sort((a, b) => new Date(a.shotDate).getTime() - new Date(b.shotDate).getTime());
  await kvSet(listings);

  return NextResponse.json({
    listings,
    savedAt: new Date().toISOString(),
    sitesChecked: sites.length,
  });
}
