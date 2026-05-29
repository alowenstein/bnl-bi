/**
 * GET /api/weekly-digest
 *
 * Vercel Cron: runs every Monday at 8:00 AM Arizona time (15:00 UTC).
 * Manually trigger: GET /api/weekly-digest?secret=<CRON_SECRET>
 *
 * 1. Fetches the 90-day HDPH shoot window + RealtyAPI status
 * 2. Keeps noteworthy listings (sold, pending, backup offers, price change, off market)
 * 3. Composes a text message for each via Claude haiku
 * 4. Emails Assaf a digest with one "Approve All & Send Texts" button
 */

import { NextResponse } from "next/server";
import * as crypto from "crypto";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import {
  determineListing, streetName,
  type HdphSite, type RealtyApiResult, type PriceHistoryEntry,
  mapZillowStatus, getStatusDate,
} from "@/lib/listing-utils";
import type { ListingEntry, DisplayStatus } from "@/types/listing-status";

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE      = process.env.HDPH_BASE_URL  ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY       = process.env.HDPH_API_KEY   ?? "";
const REALTYAPI_KEY  = process.env.REALTYAPI_KEY  ?? "";
const REALTYAPI_BASE = "https://zillow.realtyapi.io";
const WINDOW_DAYS    = 90;
const CONCURRENCY    = 10;
const TIMEOUT_MS     = 10_000;
const BROWSER_UA     =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const GMAIL_USER     = process.env.GMAIL_USER          ?? "";
const GMAIL_PASS     = process.env.GMAIL_APP_PASSWORD  ?? "";
const DIGEST_SECRET  = process.env.DIGEST_SECRET       ?? "";
const APP_URL        = process.env.NEXT_PUBLIC_APP_URL ?? "https://bnl-bi.vercel.app";

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const cronSecret   = process.env.CRON_SECRET  ?? "";
  const digestSecret = process.env.DIGEST_SECRET ?? "";
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  // Manual trigger uses ?secret=<DIGEST_SECRET>
  const authHeader = req.headers.get("authorization");
  const urlSecret  = new URL(req.url).searchParams.get("secret");
  return (
    (!!cronSecret   && authHeader === `Bearer ${cronSecret}`) ||
    (!!digestSecret && urlSecret  === digestSecret)
  );
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

async function pLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
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

// ── HDPH + RealtyAPI (mirrors listing-changes/route.ts) ──────────────────────

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
  try { return JSON.parse(text) as HdphSite[]; }
  catch { throw new Error(`HDPH JSON parse failed`); }
}

function withinWindow(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && d.getTime() >= Date.now() - days * 86_400_000;
}

async function fetchRealtyApiStatus(site: HdphSite): Promise<RealtyApiResult | null> {
  const addr = [site.address, site.address2, site.city, site.state, site.zip].filter(Boolean).join(" ");
  const url  = `${REALTYAPI_BASE}/pro/byaddress?propertyaddress=${encodeURIComponent(addr)}`;
  try {
    const res = await fetch(url, {
      headers: { "x-realtyapi-key": REALTYAPI_KEY, "User-Agent": BROWSER_UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json() as { propertyDetails?: Record<string, unknown> };
    const pd = json.propertyDetails;
    if (!pd?.homeStatus) return null;
    const status     = mapZillowStatus(pd.homeStatus as string, pd.listingSubType as Record<string,boolean>|null, pd.contingentListingType as string|null);
    const rawHistory = (pd.priceHistory as PriceHistoryEntry[] | null) ?? [];
    const price      = (pd.price as number | null) ?? null;
    const listingUrl = pd.hdpUrl ? `https://www.zillow.com${pd.hdpUrl as string}` : `https://www.zillow.com/homes/${encodeURIComponent(addr.replace(/\s+/g,"-"))}_rb/`;
    const statusDate = getStatusDate(rawHistory, status);
    const photoUrl   = (pd.hiResImageLink as string | null) ?? null;
    return { status, price, listingUrl, statusDate, photoUrl, priceHistory: rawHistory };
  } catch { return null; }
}

// ── Token signing ─────────────────────────────────────────────────────────────

export interface SendJob { phone: string; message: string; address: string }

export function buildApproveToken(jobs: SendJob[]): string {
  const payload = Buffer.from(JSON.stringify({
    jobs,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", DIGEST_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

// ── Message composition ───────────────────────────────────────────────────────

const EVENT_LABELS: Record<DisplayStatus, string> = {
  sold:           "sold / closed",
  pending:        "went pending / under contract",
  backup_offers:  "went contingent",
  price_change:   "had a price reduction",
  off_market:     "went off market",
  for_sale:       "is still for sale",
};

function fallbackMessage(entry: ListingEntry): string {
  const name   = entry.agentName.trim().split(" ")[0];
  const street = streetName(entry.address);
  switch (entry.displayStatus) {
    case "sold":           return `Congrats on closing ${street}, ${name}! Let me know if you need shots for the next one.`;
    case "pending":        return `${name}, congrats on getting ${street} under contract!`;
    case "backup_offers":  return `${name}, saw ${street} went contingent — hope it goes smoothly!`;
    case "price_change":   return `${name}, saw the price update on ${street} — how are you planning to market it? Happy to brainstorm if it helps.`;
    case "off_market":     return `${name}, hope everything's going well with ${street}. Let me know if you re-list.`;
    default:               return `${name}, wanted to touch base about ${street}.`;
  }
}

async function composeMessage(entry: ListingEntry): Promise<string> {
  const client     = new Anthropic();
  const firstName  = entry.agentName.trim().split(" ")[0];
  const street     = streetName(entry.address);
  const priceNote  = entry.currentPrice && entry.displayStatus === "price_change"
    ? ` New price is $${entry.currentPrice.toLocaleString()}.`
    : "";
  const statusHint: Partial<Record<DisplayStatus, string>> = {
    price_change:  " Lead with a genuine question about how they plan to market the new price — then offer to brainstorm or jump on a quick call. Don't pitch anything. Do NOT mention photos or photo shoots.",
    pending:       " Just acknowledge the milestone warmly. One sentence, nothing more. Do NOT offer photos, services, or anything — just a genuine congrats.",
    backup_offers: " Just say congrats and hope it closes smoothly. One warm sentence. Do NOT mention photos, backup offers, backup marketing, or any service. Never use the word 'backup' in the message.",
    sold:          " Congratulate on closing. Keep it brief. A light mention of being available for their next listing is fine, but do NOT make it salesy.",
    off_market:    " Keep it brief and warm. Express hope things work out. Do NOT offer services.",
  };

  const prompt = `You write text messages from Assaf, a real estate photographer in Scottsdale AZ, to the agent whose listing just changed status. Assaf is friendly and direct — he texts like a colleague, not a marketer. No opener like "Hi [name]," unless it feels natural. No emojis. One or two short sentences max. Never write a generic "just checking in" — always acknowledge the specific event.${statusHint[entry.displayStatus] ?? ""}

Write a message for:
- Agent first name: ${firstName}
- Street: ${street}
- What happened: ${EVENT_LABELS[entry.displayStatus]}${priceNote}

Reply with only the message text.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

// ── Email HTML ────────────────────────────────────────────────────────────────

const BADGE_COLORS: Record<DisplayStatus, { bg: string; color: string; label: string }> = {
  sold:           { bg: "#d1fae5", color: "#065f46", label: "Sold" },
  pending:        { bg: "#fef3c7", color: "#92400e", label: "Pending" },
  backup_offers:  { bg: "#ffedd5", color: "#9a3412", label: "Backup Offers" },
  price_change:   { bg: "#dbeafe", color: "#1e40af", label: "Price Change" },
  off_market:     { bg: "#f3f4f6", color: "#4b5563", label: "Off Market" },
  for_sale:       { bg: "#f3f4f6", color: "#6b7280", label: "For Sale" },
};

function buildCard(entry: ListingEntry, message: string): string {
  const badge      = BADGE_COLORS[entry.displayStatus];
  const shotDate   = new Date(entry.shotDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const statusDate = entry.statusDate
    ? new Date(entry.statusDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const priceRow = entry.displayStatus === "price_change" && entry.previousPrice && entry.currentPrice
    ? `<p style="margin:4px 0;font-size:12px;color:#555;">$${entry.previousPrice.toLocaleString()} → <strong>$${entry.currentPrice.toLocaleString()}</strong></p>`
    : entry.currentPrice
      ? `<p style="margin:4px 0;font-size:12px;color:#555;">$${entry.currentPrice.toLocaleString()}</p>`
      : "";

  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;height:100%;box-sizing:border-box;">
    <div style="margin-bottom:6px;">
      <span style="background:${badge.bg};color:${badge.color};font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;">${badge.label}</span>
      ${statusDate ? `<span style="font-size:11px;color:#9ca3af;margin-left:6px;">on ${statusDate}</span>` : ""}
      <span style="font-size:11px;color:#d1d5db;margin-left:4px;">· shot ${shotDate}</span>
    </div>
    <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#111;">${entry.address}${entry.address2 ? ` ${entry.address2}` : ""}</p>
    <p style="margin:0 0 3px;font-size:11px;color:#9ca3af;">${entry.city}, ${entry.state}${entry.mls ? ` · MLS# ${entry.mls}` : ""}</p>
    ${priceRow}
    <p style="margin:6px 0 0;font-size:12px;color:#555;"><strong>${entry.agentName}</strong>${entry.agentPhone ? `<br>${entry.agentPhone}` : ""}</p>
    <div style="background:#f9fafb;border-left:3px solid #d1d5db;border-radius:4px;padding:8px 10px;margin-top:10px;">
      <p style="margin:0;font-size:12px;color:#374151;line-height:1.5;font-style:italic;">"${message}"</p>
    </div>
    <div style="margin-top:10px;">
      <a href="${entry.listingUrl}" style="font-size:11px;color:#6b7280;text-decoration:underline;">Zillow ↗</a>
      &nbsp;&nbsp;&nbsp;
      <a href="${entry.hdphUrl}" style="font-size:11px;color:#6b7280;text-decoration:underline;">HD Photo Hub ↗</a>
    </div>
  </div>`;
}

function buildEmailHtml(
  listings: ListingEntry[],
  messages: string[],
  approveUrl: string,
): string {
  // Build 2-column table layout (email-client-safe)
  const rows: string[] = [];
  for (let i = 0; i < listings.length; i += 2) {
    const left  = buildCard(listings[i],   messages[i]);
    const right = i + 1 < listings.length ? buildCard(listings[i + 1], messages[i + 1]) : "";
    rows.push(`
      <tr>
        <td width="50%" valign="top" style="padding:6px 6px 6px 0;">${left}</td>
        <td width="50%" valign="top" style="padding:6px 0 6px 6px;">${right}</td>
      </tr>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:680px;margin:32px auto;padding:0 12px;">

    <!-- Header -->
    <div style="background:#111;border-radius:12px 12px 0 0;padding:22px 28px;">
      <p style="margin:0;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.08em;">Builds 'n Lenses</p>
      <h1 style="margin:4px 0 0;font-size:22px;font-weight:700;color:#fff;">Weekly Listing Digest</h1>
    </div>

    <!-- Summary bar -->
    <div style="background:#1f2937;padding:12px 28px;">
      <p style="margin:0;font-size:13px;color:#d1d5db;">
        <strong style="color:#fff;">${listings.length} listing${listings.length !== 1 ? "s" : ""}</strong> need follow-up this week
      </p>
    </div>

    <!-- Body -->
    <div style="background:#f9fafb;padding:20px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${rows.join("")}
      </table>

      <!-- Approve all button -->
      <div style="text-align:center;margin:24px 0 14px;">
        <a href="${approveUrl}"
           style="display:inline-block;background:#16a34a;color:#fff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">
          ✅ Approve All &amp; Send Texts
        </a>
        <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Sends all ${listings.length} text${listings.length !== 1 ? "s" : ""} to agents via OpenPhone</p>
      </div>

      <!-- Dashboard link -->
      <div style="text-align:center;margin-top:8px;">
        <a href="${APP_URL}"
           style="display:inline-block;background:#fff;border:1px solid #d1d5db;color:#374151;font-size:14px;font-weight:500;padding:10px 24px;border-radius:8px;text-decoration:none;">
          Open Dashboard →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f3f4f6;border-top:1px solid #e5e7eb;padding:14px 20px;border-radius:0 0 12px 12px;">
      <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">
        BNL BI · Monday digest · Approve link expires in 7 days
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!HDPH_KEY || !REALTYAPI_KEY) {
    return NextResponse.json({ error: "Missing HDPH or RealtyAPI credentials" }, { status: 503 });
  }
  const dryRun = new URL(req.url).searchParams.has("dry");

  if (!dryRun && (!GMAIL_USER || !GMAIL_PASS)) {
    return NextResponse.json({ error: "Missing Gmail credentials", gmailUser: !!GMAIL_USER, gmailPass: !!GMAIL_PASS }, { status: 503 });
  }
  if (!DIGEST_SECRET) {
    return NextResponse.json({ error: "Missing DIGEST_SECRET" }, { status: 503 });
  }

  // 1. Fetch HDPH sites and filter to delivered shoots in the 90-day window
  const allSites = await fetchHdphSites();
  const sites    = allSites.filter(
    (s) => withinWindow(s.created, WINDOW_DAYS) &&
           s.media?.some((m) => m.type === "still" && !m.hidden)
  );

  // 2. Query RealtyAPI with concurrency limit
  const apiResults = await pLimit(
    sites.map((site) => () => fetchRealtyApiStatus(site)),
    CONCURRENCY,
  );

  // 3. Build listings — keep noteworthy ones where the status event is recent
  //    (within 8 days so we don't re-notify about stale changes in future digests)
  const DIGEST_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
  const allListings: ListingEntry[] = [];
  for (let i = 0; i < sites.length; i++) {
    const site   = sites[i];
    const result = apiResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;
    const hdphUrl = `${HDPH_BASE.replace("/api/v1", "")}/Sites/summary.asp?nSiteID=${site.sid}`;
    const entry   = determineListing(site, result.value, hdphUrl);
    if (!entry || entry.displayStatus === "for_sale") continue;
    // Skip if we know the status event is older than 8 days (already notified last week)
    if (entry.statusDate && Date.now() - new Date(entry.statusDate).getTime() > DIGEST_WINDOW_MS) continue;
    allListings.push(entry);
  }

  allListings.sort((a, b) => new Date(a.shotDate).getTime() - new Date(b.shotDate).getTime());

  if (allListings.length === 0) {
    return NextResponse.json({ sent: false, reason: "No noteworthy listings this week" });
  }

  // 4. Compose text messages — limit to 3 concurrent to avoid Claude rate limits
  const messageResults = await pLimit(
    allListings.map((entry) => () => composeMessage(entry)),
    3,
  );
  const messages = messageResults.map((r, i) =>
    r.status === "fulfilled" && r.value
      ? r.value
      : fallbackMessage(allListings[i])
  );

  // 5. Build signed approve token for listings that have a phone number
  const sendJobs: SendJob[] = allListings
    .map((entry, i) => entry.agentPhone ? { phone: entry.agentPhone, message: messages[i], address: entry.address } : null)
    .filter((j): j is SendJob => j !== null);

  const token      = buildApproveToken(sendJobs);
  const approveUrl = `${APP_URL}/api/approve-send?token=${encodeURIComponent(token)}`;

  // 6. Send email (skip in dry-run mode)
  if (dryRun) {
    return NextResponse.json({
      dryRun:        true,
      listingCount:  allListings.length,
      sendableCount: sendJobs.length,
      listings:      allListings.map((e, i) => ({
        address:     e.address,
        status:      e.displayStatus,
        agent:       e.agentName,
        phone:       e.agentPhone,
        message:     messages[i],
      })),
    });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const html = buildEmailHtml(allListings, messages, approveUrl);
  await transporter.sendMail({
    from:    `"Builds 'n Lenses Business Intelligence" <${GMAIL_USER}>`,
    to:      GMAIL_USER,
    subject: `📋 Weekly Digest — ${allListings.length} listing${allListings.length !== 1 ? "s" : ""} to follow up`,
    html,
  });

  return NextResponse.json({
    sent:          true,
    listingCount:  allListings.length,
    sendableCount: sendJobs.length,
  });
}
