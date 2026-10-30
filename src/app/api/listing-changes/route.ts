/**
 * GET /api/listing-changes  — instant: reads KV, returns cached data immediately.
 *   Sets needsRefresh:true when KV is empty or stale (>1 h). The client calls
 *   POST in the background when it sees that flag.
 *
 * POST /api/listing-changes — async refresh: fetches HDPH, calls RealtyAPI for
 *   new/stale sites, and saves results to KV in batches so even a timeout
 *   preserves partial progress. Takes up to maxDuration (60 s on Pro, 10 s on
 *   Hobby — but partial progress is fine; the next GET will trigger another POST
 *   for the remaining sites).
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
const CACHE_STALE_MS        = 60 * 60 * 1000;      // trigger refresh after 1 h
const REALTY_RECHECK_MS     = 4 * 60 * 60 * 1000;  // re-check each site every 4 h
const REALTYAPI_CONCURRENCY = 30;
const REALTYAPI_TIMEOUT_MS  = 5_000;
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
    const listingUrl = pd.hdpUrl
      ? `https://www.zillow.com${pd.hdpUrl as string}`
      : `https://www.zillow.com/homes/${encodeURIComponent(fullAddress.replace(/\s+/g, "-"))}_rb/`;
    const statusDate = getStatusDate(rawHistory, status);
    const photoUrl   = (pd.hiResImageLink as string | null) ?? null;

    return { status, price, listingUrl, statusDate, photoUrl, priceHistory: rawHistory };
  } catch { return null; }
}

// ── Build output from KV snapshots ────────────────────────────────────────────

function buildOutput(snapshots: Record<number, SiteSnapshot>) {
  const listings:  ListingEntry[]      = [];
  const imageFlow: ImageFlowCandidate[] = [];

  for (const snap of Object.values(snapshots)) {
    if (!snap?.result) continue;
    const { site } = snap;
    const hdphUrl  = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;
    const entry    = determineListing(site, snap.result, hdphUrl);
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
  return { listings, imageFlow };
}

// ── GET — instant KV read ─────────────────────────────────────────────────────

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
      needsRefresh: false,
      cached:       true,
      fetchedAt:    new Date(l1.fetchedAt).toISOString(),
      sitesChecked: l1.data.length,
    });
  }

  // L2: read KV (no RealtyAPI calls — always fast)
  const kvCache = await kvGet<DashboardKVCache>(KV_DASHBOARD_KEY) ?? { snapshots: {}, savedAt: 0 };

  const needsRefresh =
    bust ||
    kvCache.savedAt === 0 ||
    nowMs - kvCache.savedAt > CACHE_STALE_MS;

  const { listings, imageFlow } = buildOutput(kvCache.snapshots);

  if (!needsRefresh) {
    l1 = { data: listings, imageFlow, fetchedAt: nowMs };
  }

  return NextResponse.json({
    listings,
    imageFlow,
    needsRefresh,
    cached:       true,
    fetchedAt:    kvCache.savedAt ? new Date(kvCache.savedAt).toISOString() : new Date(nowMs).toISOString(),
    sitesChecked: Object.keys(kvCache.snapshots).length,
  });
}

// ── POST — background refresh, fault-tolerant ─────────────────────────────────

export async function POST(req: Request) {
  if (!HDPH_KEY || !REALTYAPI_KEY) {
    return NextResponse.json({ error: "Missing API credentials" }, { status: 503 });
  }

  const bust  = new URL(req.url).searchParams.has("bust");
  const nowMs = Date.now();

  // Load current KV snapshots
  const kvCache   = await kvGet<DashboardKVCache>(KV_DASHBOARD_KEY) ?? { snapshots: {}, savedAt: 0 };
  const snapshots = kvCache.snapshots;

  // Fetch HDPH site list
  const allSites = await fetchHdphSites();
  const sites    = allSites.filter(
    (s) => withinWindow(s.created, WINDOW_DAYS) &&
           s.media?.some((m) => m.type === "still" && !m.hidden)
  );

  // Determine which sites need a RealtyAPI call
  const toCheck = sites.filter((s) => {
    if (bust) return true;
    const snap = snapshots[s.sid];
    return !snap || nowMs - snap.checkedAt > REALTY_RECHECK_MS;
  });

  // Process in batches and save to KV after each batch.
  // If this function times out, completed batches are already persisted
  // and will be skipped on the next POST (their checkedAt is fresh).
  let apiCalls = 0;
  for (let i = 0; i < toCheck.length; i += REALTYAPI_CONCURRENCY) {
    const batch   = toCheck.slice(i, i + REALTYAPI_CONCURRENCY);
    const results = await pLimit(batch.map((site) => () => fetchRealtyApiStatus(site)), REALTYAPI_CONCURRENCY);

    for (let j = 0; j < batch.length; j++) {
      const site   = batch[j];
      const r      = results[j];
      const result = r.status === "fulfilled" ? r.value : null;
      if (result !== null) {
        snapshots[site.sid] = { site, result, checkedAt: nowMs };
        apiCalls++;
      } else if (snapshots[site.sid]) {
        snapshots[site.sid].site = site; // refresh HDPH data even if RealtyAPI failed
      }
    }

    await kvSet(KV_DASHBOARD_KEY, { snapshots, savedAt: nowMs });
  }

  // Keep HDPH data current for sites not re-checked this run
  const checkedSids = new Set(toCheck.map((s) => s.sid));
  for (const site of sites) {
    if (!checkedSids.has(site.sid) && snapshots[site.sid]) {
      snapshots[site.sid].site = site;
    }
  }

  // Prune sites that have rolled out of the window
  const activeSids = new Set(sites.map((s) => s.sid));
  for (const sid of Object.keys(snapshots)) {
    if (!activeSids.has(Number(sid))) delete snapshots[Number(sid)];
  }

  await kvSet(KV_DASHBOARD_KEY, { snapshots, savedAt: nowMs });

  const { listings, imageFlow } = buildOutput(snapshots);
  l1 = { data: listings, imageFlow, fetchedAt: nowMs };

  return NextResponse.json({
    listings,
    imageFlow,
    needsRefresh: false,
    cached:       false,
    fetchedAt:    new Date(nowMs).toISOString(),
    sitesChecked: sites.length,
    apiCalls,
  });
}
