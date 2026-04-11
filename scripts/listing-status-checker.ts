#!/usr/bin/env node
/**
 * Listing Status Checker
 *
 * Runs weekly. For each HDPH shoot from the past 60 days:
 *   1. Looks up current listing status via RealtyAPI (Zillow data)
 *   2. Compares against stored snapshot to detect changes
 *   3. Sends an HTML email digest to GMAIL_USER if changes found
 *   4. Writes changes to /data/listing-change-log.json for the dashboard
 *
 * Set REALTYAPI_MOCK=true in .env.local to use deterministic mock data.
 */

import nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ── Types (inlined — script stays self-contained, no src/ imports) ─────────────

type ListingStatus =
  | "For Sale" | "Pending" | "Under Contract"
  | "Accepting Backup Offers" | "Sold" | "Off Market" | "Unknown";

type ChangeType =
  | "pending" | "backup_offers" | "sold"
  | "price_change" | "back_on_market" | "off_market";

interface ListingSnapshot {
  sid: number;
  address: string; city: string; state: string; zip: string;
  mls: string | null;
  agentName: string; agentEmail: string;
  shotDate: string;
  lastChecked: string;
  lastStatus: ListingStatus;
  lastPrice: number | null;
  listingUrl: string;
}

interface ListingChange {
  id: string;
  sid: number;
  address: string; city: string; state: string;
  mls: string | null;
  agentName: string; agentEmail: string;
  changeType: ChangeType;
  previousStatus: ListingStatus; currentStatus: ListingStatus;
  previousPrice: number | null;  currentPrice: number | null;
  priceDelta: number | null;
  detectedAt: string;
  listingUrl: string;
}

interface SnapshotStore {
  lastRun: string | null;
  snapshots: Record<number, ListingSnapshot>;
}

interface ChangeLogStore {
  changes: ListingChange[];
}

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE        = process.env.HDPH_BASE_URL     ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY         = process.env.HDPH_API_KEY       ?? "";
const GMAIL_USER       = process.env.GMAIL_USER         ?? "";
const GMAIL_PASS       = process.env.GMAIL_APP_PASSWORD ?? "";
const REALTYAPI_KEY    = process.env.REALTYAPI_KEY      ?? "";
const REALTYAPI_MOCK   = process.env.REALTYAPI_MOCK === "true";
const REALTYAPI_BASE   = "https://zillow.realtyapi.io";
const WINDOW_DAYS      = 60;
const MAX_LOG_ENTRIES  = 200;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_FILE  = path.join(__dirname, "../data/listing-snapshots.json");
const CHANGE_LOG_FILE = path.join(__dirname, "../data/listing-change-log.json");

// ── HDPH types ────────────────────────────────────────────────────────────────

interface HdphUser { uid: number; name: string; email: string; phone?: string; }
interface HdphSite {
  sid: number; status: string; purchased: string; created: string;
  address: string; city?: string; state?: string; zip?: string;
  mls?: string; price?: number;
  user: HdphUser;
  media: { mid: number; type: string; name: string; hidden: boolean; url?: string }[];
}

function getFirstPhotoUrl(site: HdphSite): string | null {
  // Find first visible still photo with a real URL (not the /z.jpg placeholder)
  const photo = site.media?.find(
    (m) => m.type === "still" && !m.hidden && m.url && !m.url.endsWith("/z.jpg")
  );
  return photo?.url ?? null;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function loadSnapshots(): SnapshotStore {
  try { return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf-8")) as SnapshotStore; }
  catch { return { lastRun: null, snapshots: {} }; }
}

function saveSnapshots(store: SnapshotStore): void {
  fs.mkdirSync(path.dirname(SNAPSHOTS_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(store, null, 2));
}

function loadChangeLog(): ChangeLogStore {
  try { return JSON.parse(fs.readFileSync(CHANGE_LOG_FILE, "utf-8")) as ChangeLogStore; }
  catch { return { changes: [] }; }
}

function saveChangeLog(store: ChangeLogStore): void {
  fs.mkdirSync(path.dirname(CHANGE_LOG_FILE), { recursive: true });
  fs.writeFileSync(CHANGE_LOG_FILE, JSON.stringify(store, null, 2));
}

// ── HDPH fetch ────────────────────────────────────────────────────────────────

async function fetchSites(): Promise<HdphSite[]> {
  const res = await fetch(`${HDPH_BASE}/sites`, {
    headers: { api_key: HDPH_KEY, "User-Agent": BROWSER_UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HDPH error ${res.status}`);

  let text = await res.text();

  // HDPH /sites occasionally hits an ASP server timeout and injects an HTML
  // error page mid-response, breaking the JSON. Detect the first <font tag
  // (from the ASP error page) and recover valid records from before it.
  const htmlInjectionIdx = text.indexOf("<font");
  if (htmlInjectionIdx !== -1) {
    const before = text.slice(0, htmlInjectionIdx);
    // Each site record ends with `}]},` (closes media[] and the site object).
    // Find the last complete record and close the outer array there.
    const lastRecordEnd = Math.max(
      before.lastIndexOf("}]},"),
      before.lastIndexOf("}]},\r"),
    );
    if (lastRecordEnd !== -1) {
      // Slice to end of last complete record (include the `}]}`), drop trailing comma
      text = before.slice(0, lastRecordEnd + 3) + "]";
    } else {
      // Fallback: truncate at last `}` and close the array
      const lastBrace = before.lastIndexOf("}");
      text = before.slice(0, lastBrace + 1) + "]";
    }
    console.warn("⚠️  HDPH API returned partial response (ASP timeout). Recovered partial results.");
  }

  return JSON.parse(text) as HdphSite[];
}

function withinWindow(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return !isNaN(d.getTime()) && d >= cutoff;
}

// ── RealtyAPI ─────────────────────────────────────────────────────────────────

interface RealtyApiListingSubType {
  isPending?: boolean;
  isFSBA?: boolean;
  isFSBO?: boolean;
  isNewHome?: boolean;
  isForeclosure?: boolean;
  isBankOwned?: boolean;
  isForAuction?: boolean;
  isComingSoon?: boolean;
}

interface RealtyApiPropertyDetails {
  homeStatus?: string;
  price?: number;
  hdpUrl?: string;
  zpid?: number;
  contingentListingType?: string | null;
  listingSubType?: RealtyApiListingSubType;
}

interface RealtyApiResponse {
  message: string;
  propertyDetails: RealtyApiPropertyDetails;
}

interface RealtyApiResult {
  status: ListingStatus;
  price: number | null;
  listingUrl: string;
}

function mapRealtyApiStatus(
  homeStatus: string | undefined,
  subType?: RealtyApiListingSubType,
  contingentType?: string | null
): ListingStatus {
  if (!homeStatus) return "Unknown";

  // Check for backup offers (contingent under contract)
  if (contingentType) return "Accepting Backup Offers";

  // Check pending flag even when homeStatus says FOR_SALE
  if (subType?.isPending) return "Pending";

  switch (homeStatus) {
    case "FOR_SALE":     return "For Sale";
    case "PENDING":      return "Pending";
    case "SOLD":
    case "RECENTLY_SOLD": return "Sold";
    case "FOR_RENT":     return "Unknown";  // rental — treat as unknown listing status
    case "OTHER":        return "Off Market";
    default:             return "Unknown";
  }
}

function mockRealtyApiListing(site: HdphSite): RealtyApiResult {
  // Deterministic by sid so results are stable across runs
  const hash = site.sid % 10;
  const status: ListingStatus =
    hash <= 5 ? "For Sale" :
    hash <= 7 ? "Pending" :
    hash === 8 ? "Sold" : "Off Market";
  const price = site.price ?? 750_000 + (site.sid % 500) * 1_000;
  const slug = [site.address, site.city, site.state, site.zip]
    .filter(Boolean).join(" ").toLowerCase()
    .replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
  return { status, price, listingUrl: `https://www.zillow.com/homes/${slug}_rb/` };
}

async function fetchRealtyApiListing(site: HdphSite): Promise<RealtyApiResult | null> {
  if (REALTYAPI_MOCK) return mockRealtyApiListing(site);

  // Build full address string for lookup
  const fullAddress = [site.address, site.city, site.state, site.zip]
    .filter(Boolean).join(" ");

  const url = `${REALTYAPI_BASE}/pro/byaddress?propertyaddress=${encodeURIComponent(fullAddress)}`;
  const res = await fetch(url, {
    headers: {
      "x-realtyapi-key": REALTYAPI_KEY,
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`RealtyAPI ${res.status}`);

  const json = await res.json() as RealtyApiResponse;
  const pd = json.propertyDetails;

  // Empty propertyDetails means property not found (404 message)
  if (!pd || !pd.homeStatus) return null;

  const status = mapRealtyApiStatus(pd.homeStatus, pd.listingSubType ?? undefined, pd.contingentListingType);
  const price = pd.price ?? null;
  const listingUrl = pd.hdpUrl
    ? `https://www.zillow.com${pd.hdpUrl}`
    : `https://www.zillow.com/homes/${encodeURIComponent(fullAddress.replace(/\s+/g, "-"))}_rb/`;

  return { status, price, listingUrl };
}

// ── Change detection ──────────────────────────────────────────────────────────

function detectChange(
  snap: Pick<ListingSnapshot, "lastStatus" | "lastPrice">,
  status: ListingStatus,
  price: number | null
): ChangeType | null {
  const prev      = snap.lastStatus;
  const wasActive = prev === "For Sale" || prev === "Unknown";

  if (wasActive && (status === "Pending" || status === "Under Contract")) return "pending";
  if (wasActive && status === "Accepting Backup Offers")                   return "backup_offers";
  if (wasActive && status === "Sold")                                      return "sold";
  if (wasActive && status === "Off Market")                                return "off_market";

  const wasContingent = ["Pending", "Under Contract", "Accepting Backup Offers", "Off Market"].includes(prev);
  if (status === "For Sale" && wasContingent)                              return "back_on_market";

  if (
    status === "For Sale" &&
    prev  === "For Sale" &&
    price !== null &&
    snap.lastPrice !== null &&
    price !== snap.lastPrice
  ) return "price_change";

  return null;
}

// ── Email ─────────────────────────────────────────────────────────────────────

const CHANGE_LABELS: Record<ChangeType, string> = {
  sold: "Sold", pending: "Pending / Under Contract",
  backup_offers: "Accepting Backup Offers", price_change: "Price Change",
  back_on_market: "Back on Market", off_market: "Off Market",
};

const CHANGE_COLORS: Record<ChangeType, string> = {
  sold: "#15803d", pending: "#b45309", backup_offers: "#c2410c",
  price_change: "#1d4ed8", back_on_market: "#7c3aed", off_market: "#6b7280",
};

function fmt(p: number | null) { return p === null ? "—" : `$${p.toLocaleString()}`; }

function buildEmailHtml(changes: ListingChange[]): string {
  const ORDER: ChangeType[] = ["sold", "pending", "backup_offers", "price_change", "back_on_market", "off_market"];
  const byType: Partial<Record<ChangeType, ListingChange[]>> = {};
  for (const c of changes) { (byType[c.changeType] ??= []).push(c); }

  const sections = ORDER.filter((t) => byType[t]?.length).map((t) => {
    const color = CHANGE_COLORS[t];
    const cards = byType[t]!.map((c) => {
      const mlsLine = c.mls ? `MLS# ${c.mls} · ` : "";
      const priceLine = c.changeType === "price_change" && c.priceDelta !== null
        ? `<p style="margin:4px 0 0;font-size:12px;color:#555">
             ${fmt(c.previousPrice)} → <strong style="color:${color}">${fmt(c.currentPrice)}</strong>
             (${c.priceDelta > 0 ? "+" : ""}$${Math.abs(c.priceDelta).toLocaleString()})
           </p>` : "";
      return `
      <div style="background:#fff;border:1px solid #dde;border-radius:6px;padding:14px 16px;margin:0 0 8px">
        <p style="margin:0 0 4px;font-weight:600;font-size:14px">${c.address}, ${c.city} ${c.state}</p>
        <p style="margin:0;font-size:12px;color:#555">Agent: ${c.agentName} · ${mlsLine}Detected: ${new Date(c.detectedAt).toLocaleDateString()}</p>
        <p style="margin:6px 0 0;font-size:12px">
          <span style="color:#aaa">${c.previousStatus}</span> → <strong style="color:${color}">${CHANGE_LABELS[t]}</strong>
        </p>
        ${priceLine}
        <p style="margin:4px 0 0;font-size:11px"><a href="${c.listingUrl}" style="color:#2563eb">View Listing</a></p>
      </div>`;
    }).join("");
    return `<h3 style="margin:20px 0 10px;font-size:13px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.05em">
      ${CHANGE_LABELS[t]} (${byType[t]!.length})
    </h3>${cards}`;
  }).join("");

  const runDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#222">
  <div style="background:#111827;padding:20px 28px;border-radius:8px 8px 0 0">
    <p style="color:#fff;margin:0;font-size:16px;font-weight:600">Listing Status Report</p>
    <p style="color:#9ca3af;margin:6px 0 0;font-size:12px">
      ${changes.length} change${changes.length !== 1 ? "s" : ""} detected — ${runDate} | Builds 'n Lenses Media
      ${REALTYAPI_MOCK ? " · <em>MOCK DATA</em>" : ""}
    </p>
  </div>
  <div style="background:#f9fafb;padding:24px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    ${sections}
    <p style="margin-top:28px;font-size:12px;color:#888">
      Builds 'n Lenses listing status checker · Runs every Monday 9 AM AZ time
    </p>
  </div>
</div>`;
}

async function sendDigestEmail(changes: ListingChange[]): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
  const subject = `Listing Status Report — ${changes.length} change${changes.length !== 1 ? "s" : ""} detected${REALTYAPI_MOCK ? " [MOCK]" : ""}`;
  await transporter.sendMail({
    from: `"Builds 'n Lenses Media" <${GMAIL_USER}>`,
    to: GMAIL_USER,
    subject,
    html: buildEmailHtml(changes),
  });
  console.log(`✉️  Digest sent to ${GMAIL_USER}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (REALTYAPI_MOCK) console.log("⚠️  REALTYAPI_MOCK=true — using deterministic mock data");

  console.log("🔍 Fetching sites from HDPhotoHub…");
  const allSites = await fetchSites();
  console.log(`   ${allSites.length} sites total`);

  const sites = allSites.filter((s) => withinWindow(s.created, WINDOW_DAYS));
  console.log(`   ${sites.length} sites in last ${WINDOW_DAYS} days`);

  if (sites.length === 0) {
    console.log("✅ No sites in window. Nothing to check.");
    return;
  }

  const snapshotStore = loadSnapshots();
  const newChanges: ListingChange[] = [];
  let checked = 0; let errors = 0; let notFound = 0;

  for (const site of sites) {
    console.log(`\n🔎 SID ${site.sid} — ${site.address}…`);

    let result: RealtyApiResult | null = null;
    try {
      result = await fetchRealtyApiListing(site);
    } catch (err) {
      console.error(`   ❌ Error:`, err);
      errors++;
      continue;
    }

    if (!result) {
      console.log(`   — Not found in Zillow`);
      notFound++;
      continue;
    }

    console.log(`   Status: ${result.status} | Price: ${fmt(result.price)}`);
    checked++;

    const now = new Date().toISOString();
    const existing = snapshotStore.snapshots[site.sid];

    const agentPhone = site.user.phone?.trim() || null;
    const photoUrl   = getFirstPhotoUrl(site);

    if (!existing) {
      snapshotStore.snapshots[site.sid] = {
        sid: site.sid, address: site.address,
        city: site.city ?? "", state: site.state ?? "", zip: site.zip ?? "",
        mls: site.mls ?? null,
        agentName: site.user.name, agentEmail: site.user.email, agentPhone,
        shotDate: site.created, lastChecked: now,
        lastStatus: result.status, lastPrice: result.price,
        listingUrl: result.listingUrl, photoUrl,
      };
      console.log(`   ✨ New snapshot created`);
      continue;
    }

    const changeType = detectChange(existing, result.status, result.price);

    if (changeType) {
      newChanges.push({
        id: `${site.sid}-${now}`,
        sid: site.sid, address: site.address,
        city: site.city ?? "", state: site.state ?? "",
        mls: site.mls ?? null,
        agentName: site.user.name, agentEmail: site.user.email, agentPhone,
        changeType,
        previousStatus: existing.lastStatus, currentStatus: result.status,
        previousPrice: existing.lastPrice,   currentPrice: result.price,
        priceDelta: result.price !== null && existing.lastPrice !== null
          ? result.price - existing.lastPrice : null,
        detectedAt: now, listingUrl: result.listingUrl, photoUrl,
      });
      console.log(`   🔔 Change: ${CHANGE_LABELS[changeType]}`);
    } else {
      console.log(`   — No change`);
    }

    snapshotStore.snapshots[site.sid] = {
      ...existing,
      agentPhone, photoUrl,
      lastChecked: now, lastStatus: result.status,
      lastPrice: result.price, listingUrl: result.listingUrl,
    };
  }

  snapshotStore.lastRun = new Date().toISOString();
  saveSnapshots(snapshotStore);
  console.log(`\n💾 Snapshots saved (${Object.keys(snapshotStore.snapshots).length} total)`);

  if (newChanges.length > 0) {
    const log = loadChangeLog();
    log.changes = [...newChanges, ...log.changes].slice(0, MAX_LOG_ENTRIES);
    saveChangeLog(log);
    console.log(`💾 Change log updated (${newChanges.length} new entries)`);
    await sendDigestEmail(newChanges);
  }

  console.log(`\n✅ Done. Checked: ${checked}, Not found: ${notFound}, Errors: ${errors}, Changes: ${newChanges.length}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
