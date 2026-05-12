/**
 * GET /api/listing-changes
 *
 * Fetches the current 90-day HDPH shoot window live from HDPhotoHub,
 * looks up each property's current status on Zillow via RealtyAPI (all
 * calls in parallel), and returns listings that are in a noteworthy state
 * (Pending, Sold, Accepting Backup Offers, Off Market).
 *
 * Server-side cache: results are cached for 1 hour so repeated page loads
 * don't hammer the APIs. Pass ?bust=<anything> to force a fresh fetch.
 *
 * No mock data. No committed JSON. Always real.
 */

import { NextResponse } from "next/server";

// ── Types ─────────────────────────────────────────────────────────────────────

type ListingStatus =
  | "For Sale" | "Pending" | "Under Contract"
  | "Accepting Backup Offers" | "Sold" | "Off Market" | "Unknown";

type ChangeType =
  | "pending" | "backup_offers" | "sold" | "price_change"
  | "back_on_market" | "off_market";

interface ListingChange {
  id: string;
  sid: number;
  address: string; address2: string | null; city: string; state: string;
  mls: string | null;
  agentName: string; agentEmail: string; agentPhone: string | null;
  changeType: ChangeType;
  previousStatus: ListingStatus; currentStatus: ListingStatus;
  previousPrice: number | null;  currentPrice: number | null;
  priceDelta: number | null;
  shotDate: string;
  statusDate: string | null;
  detectedAt: string;
  listingUrl: string;
  hdphUrl: string;
  photoUrl: string | null;
}

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
// Shared within a warm serverless instance; cold starts re-fetch automatically.

interface CacheEntry { data: ListingChange[]; fetchedAt: number }
let cache: CacheEntry | null = null;

// ── HDPH ──────────────────────────────────────────────────────────────────────

interface HdphSite {
  sid: number; bid: number; created: string;
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

interface RealtyApiResult {
  status: ListingStatus;
  price: number | null;
  listingUrl: string;
  statusDate: string | null;
  photoUrl: string | null;
}

function mapRealtyApiStatus(
  homeStatus: string | undefined,
  subType?: Record<string, boolean> | null,
  contingentType?: string | null
): ListingStatus {
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
  history: { date: string; event: string }[] | null | undefined,
  status: ListingStatus
): string | null {
  if (!history?.length) return null;
  const keywords: Partial<Record<ListingStatus, string[]>> = {
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

    const status = mapRealtyApiStatus(
      pd.homeStatus as string,
      pd.listingSubType as Record<string, boolean> | null,
      pd.contingentListingType as string | null
    );
    const price       = (pd.price as number | null) ?? null;
    const listingUrl  = pd.hdpUrl
      ? `https://www.zillow.com${pd.hdpUrl as string}`
      : `https://www.zillow.com/homes/${encodeURIComponent(fullAddress.replace(/\s+/g, "-"))}_rb/`;
    const statusDate  = getStatusDate(pd.priceHistory as { date: string; event: string }[], status);
    const photoUrl    = (pd.hiResImageLink as string | null) ?? null;

    return { status, price, listingUrl, statusDate, photoUrl };
  } catch {
    return null;
  }
}

function statusToChangeType(status: ListingStatus): ChangeType | null {
  switch (status) {
    case "Pending":
    case "Under Contract":          return "pending";
    case "Accepting Backup Offers": return "backup_offers";
    case "Sold":                    return "sold";
    case "Off Market":              return "off_market";
    default:                        return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const bust = new URL(req.url).searchParams.has("bust");

  // Serve from cache if fresh and no bust requested
  if (!bust && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      changes:   cache.data,
      cached:    true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      count:     cache.data.length,
    });
  }

  const now = new Date().toISOString();

  // 1. Fetch all HDPH sites, filter to window
  const allSites  = await fetchHdphSites();
  const sites     = allSites.filter((s) => withinWindow(s.created, WINDOW_DAYS));

  // 2. Query RealtyAPI for all sites in parallel
  const apiResults = await Promise.allSettled(
    sites.map((site) => fetchRealtyApiStatus(site))
  );

  // 3. Build change entries for noteworthy statuses
  const changes: ListingChange[] = [];

  for (let i = 0; i < sites.length; i++) {
    const site   = sites[i];
    const result = apiResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const { status, price, listingUrl, statusDate, photoUrl: zillowPhoto } = result.value;

    const changeType = statusToChangeType(status);
    if (!changeType) continue; // For Sale / Unknown — not noteworthy

    // Skip if the status event predates our shoot — pre-existing condition
    if (statusDate && new Date(statusDate) < new Date(site.created)) continue;

    const hdphUrl  = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;
    const photoUrl = getFirstPhotoUrl(site) ?? zillowPhoto;

    changes.push({
      id:             `${site.sid}-${changeType}`, // stable across fetches so dismiss persists
      sid:            site.sid,
      address:        site.address,
      address2:       site.address2?.trim() || null,
      city:           site.city   ?? "",
      state:          site.state  ?? "",
      mls:            site.mls    ?? null,
      agentName:      site.user.name,
      agentEmail:     site.user.email,
      agentPhone:     site.user.phone?.trim() || null,
      changeType,
      previousStatus: "For Sale",
      currentStatus:  status,
      previousPrice:  price,
      currentPrice:   price,
      priceDelta:     null,
      shotDate:       site.created,
      statusDate,
      detectedAt:     now,
      listingUrl,
      hdphUrl,
      photoUrl,
    });
  }

  // Sort oldest shoot first
  changes.sort((a, b) => new Date(a.shotDate).getTime() - new Date(b.shotDate).getTime());

  cache = { data: changes, fetchedAt: Date.now() };

  return NextResponse.json({
    changes,
    cached:    false,
    fetchedAt: now,
    count:     changes.length,
    sitesChecked: sites.length,
  });
}
