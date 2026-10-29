/**
 * GET /api/listing-changes
 *
 * Two-level cache strategy:
 *   L1  In-memory (5 min)  — zero-latency for repeated hits on a warm instance
 *   L2  Vercel KV          — persists per-site RealtyAPI results across cold starts
 *
 * On each request we always re-fetch the HDPH site list (fast, ~1-2 s) so we
 * pick up new shoots immediately.  RealtyAPI is only called for sites that are
 * either new (not in the KV cache) or whose cached result is older than
 * REALTY_RECHECK_MS (4 hours).  The result: after the very first load, most
 * requests complete in ~2-3 s instead of 30-60 s.
 *
 * Pass ?bust to force a full re-check of every site (clears the KV cache).
 */

import { NextResponse } from "next/server";
import type { ListingEntry, ImageFlowCandidate } from "@/types/listing-status";
import {
  mapZillowStatus, getStatusDate, determineListing, formatPhone, getFirstPhotoUrl,
  type HdphSite, type RealtyApiResult, type PriceHistoryEntry,
} from "@/lib/listing-utils";

export const maxDuration = 60;

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE             = process.env.HDPH_BASE_URL ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY              = process.env.HDPH_API_KEY  ?? "";
const REALTYAPI_KEY         = process.env.REALTYAPI_KEY ?? "";
const REALTYAPI_BASE        = "https://zillow.realtyapi.io";
const KV_URL                = process.env.KV_REST_API_URL;
const KV_TOKEN              = process.env.KV_REST_API_TOKEN;
const USE_KV                = !!(KV_URL && KV_TOKEN);
const KV_DASHBOARD_KEY      = "listing:dashboard-cache";

const WINDOW_DAYS           = 90;
const IMAGE_FLOW_DOM        = 45;
const L1_TTL_MS             = 5 * 60 * 1000;       // 5 min in-memory
const REALTY_RECHECK_MS     = 4 * 60 * 60 * 1000;  // re-check each site every 4 h
const REALTYAPI_CONCURRENCY = 20;
const REALTYAPI_TIMEOUT_MS  = 12_000;
const BROWSER_UA            =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SiteSnapshot {
  site:       HdphSite;
  result:     RealtyApiResult | null;
  checkedAt:  number;
}
interface DashboardKVCache {
  snapshots: Record<number, SiteSnapshot>;
  savedAt:   number;
}
interface L1Cache { data: ListingEntry[]; imageFlow: ImageFlowCandidate[]; fetchedAt: number }

// ── L1 in-memory cache ────────────────────────────────────────────────────────

let l1: L1Cache | null = null;

// ── KV helpers ────────────────────────────────────────────────────────────────

async function kvGet<T>(key: string): Promise<T | null> {
  if (!USE_KV) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { result } = await res.json() as { result: string | null };
    return result ? JSON.parse(result) as T : null;
  } catch { return null; }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  if (!USE_KV) return;
  try {
    await fetch(`${KV_URL}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(value) }),
    });
  } catch { /* non-fatal */ }
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

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
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
    const fullAddr   = fullAddress;
    const listingUrl = pd.hdpUrl
      ? `https://www.zillow.com${pd.hdpUrl as string}`
      : `https://www.zillow.com/homes/${encodeURIComponent(fullAddr.replace(/\s+/g, "-"))}_rb/`;
    const statusDate = getStatusDate(rawHistory, status);
    const photoUrl   = (pd.hiResImageLink as string | null) ?? null;

    return { status, price, listingUrl, statusDate, photoUrl, priceHistory: rawHistory };
  } catch { return null; }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!HDPH_KEY || !REALTYAPI_KEY) {
    return NextResponse.json({ error: "Missing API credentials" }, { status: 503 });
  }

  const bust  = new URL(req.url).searchParams.has("bust");
  const nowMs = Date.now();

  // L1: serve from memory if fresh and no bust
  if (!bust && l1 && nowMs - l1.fetchedAt < L1_TTL_MS) {
    return NextResponse.json({
      listings:     l1.data,
      imageFlow:    l1.imageFlow,
      cached:       true,
      fetchedAt:    new Date(l1.fetchedAt).toISOString(),
      sitesChecked: l1.data.length,
    });
  }

  const now = new Date().toISOString();

  // L2: load per-site snapshots from KV
  const kvCache   = await kvGet<DashboardKVCache>(KV_DASHBOARD_KEY) ?? { snapshots: {}, savedAt: 0 };
  const snapshots = kvCache.snapshots;

  // 1. Fetch HDPH site list (always fresh — fast, ~1-2 s)
  const allSites = await fetchHdphSites();
  const sites    = allSites.filter(
    (s) => withinWindow(s.created, WINDOW_DAYS) &&
           s.media?.some((m) => m.type === "still" && !m.hidden)
  );

  // 2. Only call RealtyAPI for sites that are new or whose snapshot is stale
  const toCheck = sites.filter((s) => {
    if (bust) return true;
    const snap = snapshots[s.sid];
    return !snap || nowMs - snap.checkedAt > REALTY_RECHECK_MS;
  });

  if (toCheck.length > 0) {
    const fresh = await pLimit(
      toCheck.map((site) => () => fetchRealtyApiStatus(site)),
      REALTYAPI_CONCURRENCY,
    );
    const toCheckSids = new Set(toCheck.map((s) => s.sid));
    for (let i = 0; i < toCheck.length; i++) {
      const site = toCheck[i];
      const r    = fresh[i];
      snapshots[site.sid] = {
        site,
        result:    r.status === "fulfilled" ? r.value : null,
        checkedAt: nowMs,
      };
    }
    // Keep HDPH site data current for cached snapshots too
    for (const site of sites) {
      if (!toCheckSids.has(site.sid)) snapshots[site.sid].site = site;
    }
  }

  // 3. Prune snapshots for sites that rolled out of the window
  const activeSids = new Set(sites.map((s) => s.sid));
  for (const sid of Object.keys(snapshots)) {
    if (!activeSids.has(Number(sid))) delete snapshots[Number(sid)];
  }

  // 4. Persist updated KV cache
  await kvSet(KV_DASHBOARD_KEY, { snapshots, savedAt: nowMs });

  // 5. Build output from snapshots
  const listings:   ListingEntry[]      = [];
  const imageFlow:  ImageFlowCandidate[] = [];

  for (const site of sites) {
    const snap = snapshots[site.sid];
    if (!snap?.result) continue;

    const hdphUrl = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;
    const entry   = determineListing(site, snap.result, hdphUrl);
    if (entry) listings.push(entry);

    const dom = daysAgo(site.created);
    if (snap.result.status === "For Sale" && dom >= IMAGE_FLOW_DOM) {
      const q = encodeURIComponent(`"${site.user.name}" realtor instagram OR facebook`);
      imageFlow.push({
        sid:            site.sid,
        address:        site.address,
        address2:       site.address2?.trim() || null,
        city:           site.city   ?? "",
        state:          site.state  ?? "",
        mls:            site.mls    ?? null,
        agentName:      site.user.name,
        agentEmail:     site.user.email,
        agentPhone:     formatPhone(site.user.phone),
        shotDate:       site.created,
        daysOnMarket:   dom,
        currentPrice:   snap.result.price,
        listingUrl:     snap.result.listingUrl,
        hdphUrl,
        photoUrl:       getFirstPhotoUrl(site) ?? snap.result.photoUrl,
        socialSearchUrl: `https://www.google.com/search?q=${q}`,
      });
    }
  }

  listings.sort((a, b)  => new Date(a.shotDate).getTime() - new Date(b.shotDate).getTime());
  imageFlow.sort((a, b) => b.daysOnMarket - a.daysOnMarket);

  l1 = { data: listings, imageFlow, fetchedAt: nowMs };

  return NextResponse.json({
    listings,
    imageFlow,
    cached:       false,
    fetchedAt:    now,
    sitesChecked: sites.length,
    apiCalls:     toCheck.length,
  });
}
