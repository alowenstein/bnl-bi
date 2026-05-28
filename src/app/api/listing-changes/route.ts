/**
 * GET /api/listing-changes
 *
 * Fetches the current 90-day HDPH shoot window live from HDPhotoHub,
 * looks up each property's current status on Zillow via RealtyAPI (all
 * calls in parallel), and returns ALL listings bucketed by DisplayStatus.
 *
 * - "for_sale"     — still active, no noteworthy change (hidden by default in UI)
 * - "price_change" — price changed since the shoot date
 * - "pending"      — went pending/under contract after the shoot
 * - "backup_offers"— contingent/accepting backup offers after the shoot
 * - "sold"         — closed after the shoot
 * - "off_market"   — taken off market after the shoot
 *
 * Listings whose status event pre-dates the shoot are excluded entirely.
 *
 * Server-side cache: results are cached for 1 hour so repeated page loads
 * don't hammer the APIs. Pass ?bust=<anything> to force a fresh fetch.
 *
 * No mock data. No committed JSON. Always real.
 */

import { NextResponse } from "next/server";
import type { DisplayStatus, ListingEntry } from "@/types/listing-status";

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE      = process.env.HDPH_BASE_URL ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY       = process.env.HDPH_API_KEY  ?? "";
const REALTYAPI_KEY  = process.env.REALTYAPI_KEY ?? "";
const REALTYAPI_BASE = "https://zillow.realtyapi.io";
const WINDOW_DAYS    = 90;
const CACHE_TTL_MS   = 60 * 60 * 1000; // 1 hour
const BROWSER_UA     =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── Server-side in-memory cache ───────────────────────────────────────────────

interface CacheEntry { data: ListingEntry[]; fetchedAt: number }
let cache: CacheEntry | null = null;

// ── HDPH ──────────────────────────────────────────────────────────────────────

interface HdphSite {
  sid: number; bid: number; created: string; status: string;
  address: string; address2?: string; city?: string; state?: string; zip?: string;
  mls?: string; price?: number;
  user: { name: string; email: string; phone?: string };
  media: { type: string; hidden: boolean; url?: string }[];
}

async function fetchHdphSites(): Promise<HdphSite[]> {
  const res = await fetch(`${HDPH_BASE}/sites`, {
    headers: { api_key: HDPH_KEY, "User-Agent": BROWSER_UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HDPH ${res.status}`);

  let text = await res.text();

  // HDPH sometimes injects an ASP error page mid-JSON — recover what we can
  const htmlIdx = text.indexOf("<font");
  if (htmlIdx !== -1) {
    const before = text.slice(0, htmlIdx);
    const lastEnd = Math.max(before.lastIndexOf("}]},"), before.lastIndexOf("}]},\r"));
    text = lastEnd !== -1
      ? before.slice(0, lastEnd + 3) + "]"
      : before.slice(0, before.lastIndexOf("}") + 1) + "]";
  }

  return JSON.parse(text) as HdphSite[];
}

function withinWindow(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return !isNaN(d.getTime()) && d >= cutoff;
}

function getFirstPhotoUrl(site: HdphSite): string | null {
  return site.media?.find(
    (m) => m.type === "still" && !m.hidden && m.url && !m.url.endsWith("/z.jpg")
  )?.url ?? null;
}

// ── RealtyAPI ─────────────────────────────────────────────────────────────────

type ZillowStatus = "For Sale" | "Pending" | "Under Contract" | "Accepting Backup Offers" | "Sold" | "Off Market" | "Unknown";

interface PriceHistoryEntry {
  date: string;
  event: string;
  price?: number;
}

interface RealtyApiResult {
  status: ZillowStatus;
  price: number | null;
  listingUrl: string;
  statusDate: string | null;
  photoUrl: string | null;
  priceHistory: PriceHistoryEntry[];
}

function mapZillowStatus(
  homeStatus: string | undefined,
  subType?: Record<string, boolean> | null,
  contingentType?: string | null
): ZillowStatus {
  if (!homeStatus) return "Unknown";
  if (contingentType)       return "Accepting Backup Offers";
  if (subType?.isPending)   return "Pending";
  switch (homeStatus) {
    case "FOR_SALE":      return "For Sale";
    case "PENDING":       return "Pending";
    case "SOLD":
    case "RECENTLY_SOLD": return "Sold";
    case "OTHER":         return "Off Market";
    default:              return "Unknown";
  }
}

function getStatusDate(
  history: PriceHistoryEntry[] | null | undefined,
  status: ZillowStatus
): string | null {
  if (!history?.length) return null;
  const keywords: Partial<Record<ZillowStatus, string[]>> = {
    "Sold":                    ["sold"],
    "Pending":                 ["pending", "pending sale", "under contract"],
    "Accepting Backup Offers": ["contingent", "backup"],
    "Off Market":              ["off market", "removed", "expired", "withdrawn"],
  };
  const keys = keywords[status] ?? [];
  const match = history.find((h) => keys.some((k) => h.event.toLowerCase().includes(k)));
  return match?.date ?? history[0]?.date ?? null;
}

async function fetchRealtyApiStatus(site: HdphSite): Promise<RealtyApiResult | null> {
  const fullAddress = [site.address, site.address2, site.city, site.state, site.zip]
    .filter(Boolean).join(" ");
  const url = `${REALTYAPI_BASE}/pro/byaddress?propertyaddress=${encodeURIComponent(fullAddress)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "x-realtyapi-key": REALTYAPI_KEY,
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = await res.json() as { propertyDetails?: Record<string, unknown> };
    const pd = json.propertyDetails;
    if (!pd?.homeStatus) return null;

    const status = mapZillowStatus(
      pd.homeStatus as string,
      pd.listingSubType as Record<string, boolean> | null,
      pd.contingentListingType as string | null
    );
    const rawHistory = (pd.priceHistory as PriceHistoryEntry[] | null) ?? [];
    const price       = (pd.price as number | null) ?? null;
    const listingUrl  = pd.hdpUrl
      ? `https://www.zillow.com${pd.hdpUrl as string}`
      : `https://www.zillow.com/homes/${encodeURIComponent(fullAddress.replace(/\s+/g, "-"))}_rb/`;
    const statusDate  = getStatusDate(rawHistory, status);
    const photoUrl    = (pd.hiResImageLink as string | null) ?? null;

    return { status, price, listingUrl, statusDate, photoUrl, priceHistory: rawHistory };
  } catch {
    return null;
  }
}

// ── Price change detection ────────────────────────────────────────────────────

/**
 * Searches priceHistory (newest-first) for a "price change" event that occurred
 * on or after the shoot date. Returns the event date + the previous price entry.
 */
function detectPriceChange(
  priceHistory: PriceHistoryEntry[],
  shootDate: string,
): { statusDate: string; previousPrice: number | null } | null {
  const shootMs = new Date(shootDate).getTime();
  const idx = priceHistory.findIndex(
    (h) =>
      h.event.toLowerCase().includes("price change") &&
      new Date(h.date).getTime() >= shootMs
  );
  if (idx === -1) return null;
  const prevEntry = priceHistory[idx + 1]; // older entry (array is newest-first)
  return {
    statusDate:    priceHistory[idx].date,
    previousPrice: prevEntry?.price ?? null,
  };
}

// ── Core listing determination ────────────────────────────────────────────────

function determineListing(
  site: HdphSite,
  result: RealtyApiResult,
  now: string,
  hdphUrl: string,
): ListingEntry | null {
  const { status, price, listingUrl, statusDate, photoUrl: zillowPhoto, priceHistory } = result;
  const shootDate = site.created;
  const shootMs   = new Date(shootDate).getTime();
  const photoUrl  = getFirstPhotoUrl(site) ?? zillowPhoto;

  // For Sale or Unknown — always bucket as for_sale (price change detection disabled for now)
  if (status === "For Sale" || status === "Unknown") {
    return {
      id:            `${site.sid}-for_sale`,
      sid:           site.sid,
      address:       site.address,
      address2:      site.address2?.trim() || null,
      city:          site.city   ?? "",
      state:         site.state  ?? "",
      mls:           site.mls    ?? null,
      agentName:     site.user.name,
      agentEmail:    site.user.email,
      agentPhone:    site.user.phone?.trim() || null,
      shotDate:      shootDate,
      displayStatus: "for_sale",
      statusDate:    null,
      currentPrice:  price,
      previousPrice: null,
      listingUrl,
      hdphUrl,
      photoUrl,
    };
  }

  // For all other statuses: exclude if the event pre-dates our shoot
  if (statusDate && new Date(statusDate).getTime() < shootMs) return null;

  const displayStatusMap: Partial<Record<ZillowStatus, DisplayStatus>> = {
    "Pending":                 "pending",
    "Under Contract":          "pending",
    "Accepting Backup Offers": "backup_offers",
    "Sold":                    "sold",
    "Off Market":              "off_market",
  };
  const displayStatus = displayStatusMap[status];
  if (!displayStatus) return null; // shouldn't happen given above guard

  return {
    id:            `${site.sid}-${displayStatus}`,
    sid:           site.sid,
    address:       site.address,
    address2:      site.address2?.trim() || null,
    city:          site.city   ?? "",
    state:         site.state  ?? "",
    mls:           site.mls    ?? null,
    agentName:     site.user.name,
    agentEmail:    site.user.email,
    agentPhone:    site.user.phone?.trim() || null,
    shotDate:      shootDate,
    displayStatus,
    statusDate,
    currentPrice:  price,
    previousPrice: null,
    listingUrl,
    hdphUrl,
    photoUrl,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const bust = new URL(req.url).searchParams.has("bust");

  // Serve from cache if fresh and no bust requested
  if (!bust && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      listings:     cache.data,
      cached:       true,
      fetchedAt:    new Date(cache.fetchedAt).toISOString(),
      sitesChecked: cache.data.length,
    });
  }

  const now = new Date().toISOString();

  // 1. Fetch all HDPH sites, filter to 90-day window of active (delivered) shoots
  const allSites    = await fetchHdphSites();
  const activeOnly  = allSites.filter((s) => s.status === "active");
  const inWindow    = allSites.filter((s) => withinWindow(s.created, WINDOW_DAYS));
  const sites       = allSites.filter(
    (s) => s.status === "active" && withinWindow(s.created, WINDOW_DAYS)
  );
  // Sample statuses from the in-window sites (before active filter) for debugging
  const statusSample = [...new Set(inWindow.map((s) => s.status))].slice(0, 10);

  // 2. Query RealtyAPI for all sites in parallel
  const apiResults = await Promise.allSettled(
    sites.map((site) => fetchRealtyApiStatus(site))
  );

  // Count how many RealtyAPI calls succeeded
  const realtyApiHits = apiResults.filter(
    (r) => r.status === "fulfilled" && r.value !== null
  ).length;

  // 3. Determine display status for each listing
  const listings: ListingEntry[] = [];

  for (let i = 0; i < sites.length; i++) {
    const site   = sites[i];
    const result = apiResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const hdphUrl = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;
    const entry   = determineListing(site, result.value, now, hdphUrl);
    if (entry) listings.push(entry);
  }

  // Sort oldest shoot first
  listings.sort((a, b) => new Date(a.shotDate).getTime() - new Date(b.shotDate).getTime());

  cache = { data: listings, fetchedAt: Date.now() };

  return NextResponse.json({
    listings,
    cached:          false,
    fetchedAt:       now,
    sitesChecked:    sites.length,
    debug: {
      hdphTotal:     allSites.length,
      activeCount:   activeOnly.length,
      inWindowCount: inWindow.length,
      finalCount:    sites.length,
      statusSample,
      realtyApiHits,
    },
  });
}
