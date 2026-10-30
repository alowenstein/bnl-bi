/**
 * GET /api/listing-changes
 *
 * Fetches the current HDPH shoot window, looks up each property on Zillow
 * via RealtyAPI, and returns all listings with their current status.
 *
 * In-memory cache: 1 hour. Pass ?bust to force a fresh fetch.
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
const WINDOW_DAYS           = 90;
const CACHE_TTL_MS          = 60 * 60 * 1000;  // 1 hour
const REALTYAPI_CONCURRENCY = 30;
const REALTYAPI_TIMEOUT_MS  = 5_000;
const BROWSER_UA            =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry { listings: ListingEntry[]; fetchedAt: number }
let cache: CacheEntry | null = null;

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
  try {
    return JSON.parse(text) as HdphSite[];
  } catch {
    throw new Error(`HDPH JSON parse failed (length=${text.length})`);
  }
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

export async function GET(req: Request) {
  if (!HDPH_KEY || !REALTYAPI_KEY) {
    return NextResponse.json({ error: "Missing API credentials" }, { status: 503 });
  }

  const bust  = new URL(req.url).searchParams.has("bust");
  const nowMs = Date.now();

  if (!bust && cache && nowMs - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      listings:     cache.listings,
      cached:       true,
      fetchedAt:    new Date(cache.fetchedAt).toISOString(),
      sitesChecked: cache.listings.length,
    });
  }

  const now = new Date().toISOString();

  const allSites = await fetchHdphSites();
  const sites    = allSites.filter(
    (s) => withinWindow(s.created, WINDOW_DAYS) &&
           s.media?.some((m) => m.type === "still" && !m.hidden)
  );

  const apiResults = await pLimit(
    sites.map((site) => () => fetchRealtyApiStatus(site)),
    REALTYAPI_CONCURRENCY,
  );

  const listings: ListingEntry[] = [];
  for (let i = 0; i < sites.length; i++) {
    const site   = sites[i];
    const result = apiResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const hdphUrl = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;

    // Attach the HDPH photo URL to the result so determineListing can use it
    const enriched: RealtyApiResult = {
      ...result.value,
      photoUrl: getFirstPhotoUrl(site) ?? result.value.photoUrl,
    };

    const entry = determineListing(site, enriched, hdphUrl);
    if (entry) listings.push(entry);
  }

  listings.sort((a, b) => new Date(a.shotDate).getTime() - new Date(b.shotDate).getTime());

  cache = { listings, fetchedAt: nowMs };

  return NextResponse.json({
    listings,
    cached:       false,
    fetchedAt:    now,
    sitesChecked: sites.length,
  });
}
