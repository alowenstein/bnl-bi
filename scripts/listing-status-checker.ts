#!/usr/bin/env node
/**
 * Listing Status Checker
 *
 * Runs weekly. For each HDPH shoot from the past 60 days:
 *   1. Scrapes Zillow via Firecrawl REST API for current listing status + price
 *   2. Compares against stored snapshot to detect changes
 *   3. Sends an HTML email digest to GMAIL_USER if changes found
 *   4. Writes changes to /data/listing-change-log.json for the dashboard
 */

import nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type {
  ListingStatus,
  ChangeType,
  ListingSnapshot,
  ListingChange,
  SnapshotStore,
  ChangeLogStore,
} from "../src/types/listing-status.js";
import {
  buildZillowUrl,
  parseZillowStatus,
  parseZillowPrice,
  detectChange,
} from "../src/lib/listing-status-utils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE       = process.env.HDPH_BASE_URL      ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY        = process.env.HDPH_API_KEY        ?? "";
const GMAIL_USER      = process.env.GMAIL_USER          ?? "";
const GMAIL_PASS      = process.env.GMAIL_APP_PASSWORD  ?? "";
const FIRECRAWL_KEY   = process.env.FIRECRAWL_API_KEY   ?? "";
const WINDOW_DAYS     = 60;
const SCRAPE_DELAY_MS = 3000;
const MAX_ERRORS      = 3;
const MAX_LOG_ENTRIES = 200;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_FILE  = path.join(__dirname, "../data/listing-snapshots.json");
const CHANGE_LOG_FILE = path.join(__dirname, "../data/listing-change-log.json");

// ── Types (local subset of HdphSite for the script) ───────────────────────────

interface HdphUser {
  uid: number;
  name: string;
  email: string;
  phone?: string;
}

interface HdphSite {
  sid: number;
  status: string;
  purchased: string;
  created: string; // "3/16/2026 11:32:29 PM"
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  mls?: string;
  price?: number;
  user: HdphUser;
  media: { mid: number; type: string; name: string; hidden: boolean }[];
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function loadSnapshots(): SnapshotStore {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf-8")) as SnapshotStore;
  } catch {
    return { lastRun: null, snapshots: {} };
  }
}

function saveSnapshots(store: SnapshotStore): void {
  fs.mkdirSync(path.dirname(SNAPSHOTS_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(store, null, 2));
}

function loadChangeLog(): ChangeLogStore {
  try {
    return JSON.parse(fs.readFileSync(CHANGE_LOG_FILE, "utf-8")) as ChangeLogStore;
  } catch {
    return { changes: [] };
  }
}

function saveChangeLog(store: ChangeLogStore): void {
  fs.mkdirSync(path.dirname(CHANGE_LOG_FILE), { recursive: true });
  fs.writeFileSync(CHANGE_LOG_FILE, JSON.stringify(store, null, 2));
}

// ── HDPH Fetch ────────────────────────────────────────────────────────────────

async function fetchSites(): Promise<HdphSite[]> {
  const res = await fetch(`${HDPH_BASE}/sites`, {
    headers: {
      api_key: HDPH_KEY,
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HDPH error ${res.status}`);
  return JSON.parse(await res.text()) as HdphSite[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function withinWindow(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return !isNaN(d.getTime()) && d >= cutoff;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Firecrawl scraper ─────────────────────────────────────────────────────────

async function scrapeZillow(url: string): Promise<string | null> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const json = (await res.json()) as {
    success: boolean;
    data?: { markdown?: string };
  };
  if (!json.success || !json.data?.markdown) return null;
  // Short markdown likely means bot-wall / no listing found
  if (json.data.markdown.length < 200) return null;
  return json.data.markdown;
}

// ── Email generation ──────────────────────────────────────────────────────────

const CHANGE_LABELS: Record<ChangeType, string> = {
  sold:           "Sold",
  pending:        "Pending / Under Contract",
  backup_offers:  "Accepting Backup Offers",
  price_change:   "Price Change",
  back_on_market: "Back on Market",
  off_market:     "Off Market",
};

const CHANGE_COLORS: Record<ChangeType, string> = {
  sold:           "#15803d",
  pending:        "#b45309",
  backup_offers:  "#c2410c",
  price_change:   "#1d4ed8",
  back_on_market: "#7c3aed",
  off_market:     "#6b7280",
};

function formatPrice(p: number | null): string {
  if (p === null) return "—";
  return `$${p.toLocaleString()}`;
}

function formatPriceDelta(change: ListingChange): string {
  if (change.changeType !== "price_change" || change.priceDelta === null) return "";
  const sign = change.priceDelta > 0 ? "+" : "";
  return ` (${sign}$${Math.abs(change.priceDelta).toLocaleString()})`;
}

function buildPropertyCard(change: ListingChange): string {
  const color     = CHANGE_COLORS[change.changeType];
  const label     = CHANGE_LABELS[change.changeType];
  const mlsLine   = change.mls ? `MLS# ${change.mls} · ` : "";
  const priceLine =
    change.changeType === "price_change"
      ? `<p style="margin:4px 0 0;font-size:12px;color:#555">
           ${formatPrice(change.previousPrice)} → <strong style="color:${color}">${formatPrice(change.currentPrice)}</strong>${formatPriceDelta(change)}
         </p>`
      : "";

  return `
  <div style="background:#fff;border:1px solid #dde;border-radius:6px;padding:14px 16px;margin:0 0 8px">
    <p style="margin:0 0 4px;font-weight:600;font-size:14px">${change.address}, ${change.city} ${change.state}</p>
    <p style="margin:0;font-size:12px;color:#555">
      Agent: ${change.agentName} · ${mlsLine}Detected: ${new Date(change.detectedAt).toLocaleDateString()}
    </p>
    <p style="margin:6px 0 0;font-size:12px">
      <span style="color:#aaa">${change.previousStatus}</span>
      → <strong style="color:${color}">${label}</strong>
    </p>
    ${priceLine}
    <p style="margin:4px 0 0;font-size:11px">
      <a href="${change.zillowUrl}" style="color:#2563eb">View on Zillow</a>
    </p>
  </div>`;
}

function buildEmailHtml(changes: ListingChange[]): string {
  const ORDER: ChangeType[] = ["sold", "pending", "backup_offers", "price_change", "back_on_market", "off_market"];

  const byType: Partial<Record<ChangeType, ListingChange[]>> = {};
  for (const c of changes) {
    if (!byType[c.changeType]) byType[c.changeType] = [];
    byType[c.changeType]!.push(c);
  }

  const sections = ORDER.filter((t) => byType[t]?.length)
    .map((t) => {
      const color = CHANGE_COLORS[t];
      const label = CHANGE_LABELS[t];
      const cards = byType[t]!.map(buildPropertyCard).join("");
      return `
    <h3 style="margin:20px 0 10px;font-size:13px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.05em">
      ${label} (${byType[t]!.length})
    </h3>
    ${cards}`;
    })
    .join("");

  const runDate = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return `
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#222">
  <div style="background:#111827;padding:20px 28px;border-radius:8px 8px 0 0">
    <p style="color:#fff;margin:0;font-size:16px;font-weight:600">Listing Status Report</p>
    <p style="color:#9ca3af;margin:6px 0 0;font-size:12px">
      ${changes.length} change${changes.length !== 1 ? "s" : ""} detected — ${runDate} | Builds 'n Lenses Media
    </p>
  </div>
  <div style="background:#f9fafb;padding:24px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    ${sections}
    <p style="margin-top:28px;font-size:12px;color:#888">
      Detected by the Builds 'n Lenses listing status checker · Runs every Monday 9 AM AZ time
    </p>
  </div>
</div>`;
}

async function sendDigestEmail(changes: ListingChange[]): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const html    = buildEmailHtml(changes);
  const subject = `Listing Status Report — ${changes.length} change${changes.length !== 1 ? "s" : ""} detected`;

  const text = changes
    .map((c) => {
      const label = CHANGE_LABELS[c.changeType];
      const price = c.changeType === "price_change"
        ? ` | ${formatPrice(c.previousPrice)} → ${formatPrice(c.currentPrice)}${formatPriceDelta(c)}`
        : "";
      return `${c.address}, ${c.city} ${c.state} — ${label}${price}\n${c.zillowUrl}`;
    })
    .join("\n\n");

  await transporter.sendMail({
    from: `"Builds 'n Lenses Media" <${GMAIL_USER}>`,
    to: GMAIL_USER,
    subject,
    html,
    text,
  });

  console.log(`✉️  Digest sent to ${GMAIL_USER}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
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
  let checked = 0;
  let skipped = 0;
  let errors  = 0;

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (i > 0) await sleep(SCRAPE_DELAY_MS);

    const existing = snapshotStore.snapshots[site.sid];
    if (existing && existing.consecutiveErrors >= MAX_ERRORS) {
      console.log(`   ⏭  Skipping SID ${site.sid} — ${MAX_ERRORS} consecutive errors`);
      skipped++;
      continue;
    }

    const zillowUrl = buildZillowUrl(site);
    console.log(`\n🔎 SID ${site.sid} — ${site.address}…`);

    let markdown: string | null = null;
    try {
      markdown = await scrapeZillow(zillowUrl);
    } catch (err) {
      console.error(`   ❌ Scrape error:`, err);
      if (existing) {
        snapshotStore.snapshots[site.sid] = {
          ...existing,
          consecutiveErrors: existing.consecutiveErrors + 1,
          lastChecked: new Date().toISOString(),
        };
      }
      errors++;
      continue;
    }

    if (!markdown) {
      console.log(`   ⚠️  No usable content from Zillow (bot-wall or not listed)`);
      if (existing) {
        snapshotStore.snapshots[site.sid] = {
          ...existing,
          consecutiveErrors: existing.consecutiveErrors + 1,
          lastChecked: new Date().toISOString(),
        };
      }
      errors++;
      continue;
    }

    const currentStatus = parseZillowStatus(markdown);
    const currentPrice  = parseZillowPrice(markdown);
    console.log(`   Status: ${currentStatus} | Price: ${formatPrice(currentPrice)}`);
    checked++;

    const now = new Date().toISOString();

    if (!existing) {
      // First time we've seen this site — bootstrap snapshot, no change recorded
      snapshotStore.snapshots[site.sid] = {
        sid:               site.sid,
        address:           site.address,
        city:              site.city  ?? "",
        state:             site.state ?? "",
        zip:               site.zip   ?? "",
        mls:               site.mls   ?? null,
        agentName:         site.user.name,
        agentEmail:        site.user.email,
        shotDate:          site.created,
        lastChecked:       now,
        lastStatus:        currentStatus,
        lastPrice:         currentPrice,
        zillowUrl,
        consecutiveErrors: 0,
      };
      console.log(`   ✨ New snapshot created`);
      continue;
    }

    const changeType = detectChange(existing, currentStatus, currentPrice);

    if (changeType) {
      const change: ListingChange = {
        id:             `${site.sid}-${now}`,
        sid:            site.sid,
        address:        site.address,
        city:           site.city  ?? "",
        state:          site.state ?? "",
        mls:            site.mls   ?? null,
        agentName:      site.user.name,
        agentEmail:     site.user.email,
        changeType,
        previousStatus: existing.lastStatus,
        currentStatus,
        previousPrice:  existing.lastPrice,
        currentPrice,
        priceDelta:     currentPrice !== null && existing.lastPrice !== null
                          ? currentPrice - existing.lastPrice
                          : null,
        detectedAt:     now,
        zillowUrl,
      };
      newChanges.push(change);
      console.log(`   🔔 Change detected: ${CHANGE_LABELS[changeType]}`);
    } else {
      console.log(`   — No change`);
    }

    // Update snapshot
    snapshotStore.snapshots[site.sid] = {
      ...existing,
      lastChecked:       now,
      lastStatus:        currentStatus,
      lastPrice:         currentPrice,
      consecutiveErrors: 0,
    };
  }

  // Update lastRun and save snapshots
  snapshotStore.lastRun = new Date().toISOString();
  saveSnapshots(snapshotStore);
  console.log(`\n💾 Snapshots saved (${Object.keys(snapshotStore.snapshots).length} total)`);

  // Prepend new changes to log, cap at MAX_LOG_ENTRIES
  if (newChanges.length > 0) {
    const log = loadChangeLog();
    log.changes = [...newChanges, ...log.changes].slice(0, MAX_LOG_ENTRIES);
    saveChangeLog(log);
    console.log(`💾 Change log updated (${newChanges.length} new entries)`);

    await sendDigestEmail(newChanges);
  }

  console.log(`\n✅ Done. Checked: ${checked}, Skipped: ${skipped}, Errors: ${errors}, Changes: ${newChanges.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
