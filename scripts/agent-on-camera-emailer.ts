#!/usr/bin/env node
/**
 * Agent-On-Camera Listing Script Emailer
 *
 * Runs daily. Scans HDPH for new orders (last 4 days) that include an
 * "agent on camera" video. For each unprocessed order it:
 *   1. Generates 3 listing-script options via Claude (using the listing-script skill)
 *   2. Emails them to the agent via Gmail SMTP
 *   3. Records the site ID so the email is sent only once
 */

import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ── Config ────────────────────────────────────────────────────────────────────

const HDPH_BASE  = process.env.HDPH_BASE_URL          ?? "https://order.buildsnlenses.com/api/v1";
const HDPH_KEY   = process.env.HDPH_API_KEY            ?? "";
const GMAIL_USER = process.env.GMAIL_USER              ?? "";
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD      ?? "";
const WINDOW_DAYS = 4; // rolling look-back window

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_FILE = path.join(__dirname, "../data/processed-agent-on-camera.json");

// ── Types ─────────────────────────────────────────────────────────────────────

interface HdphMedia {
  mid: number;
  type: string;
  name: string;
  hidden: boolean;
}

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
  created: string;   // "3/16/2026 11:32:29 PM"
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  mls?: string;
  price?: number;
  user: HdphUser;
  media: HdphMedia[];
}

interface ProcessedStore {
  processedSids: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadProcessed(): ProcessedStore {
  try {
    return JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf-8"));
  } catch {
    return { processedSids: [] };
  }
}

function saveProcessed(store: ProcessedStore): void {
  fs.mkdirSync(path.dirname(PROCESSED_FILE), { recursive: true });
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(store, null, 2));
}

function withinWindow(dateStr: string, days: number): boolean {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function hasAgentOnCamera(site: HdphSite): boolean {
  return site.media.some(
    (m) => m.type === "video" && m.name.toLowerCase().includes("agent on camera")
  );
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

// ── Claude Script Generation (listing-script skill) ───────────────────────────

async function generateScripts(site: HdphSite): Promise<string> {
  const client = new Anthropic();

  const details = [
    `Address: ${site.address}${site.city ? `, ${site.city}` : ""}${site.state ? `, ${site.state}` : ""}`,
    site.beds   ? `Beds: ${site.beds}`                          : null,
    site.baths  ? `Baths: ${site.baths}`                        : null,
    site.sqft   ? `SqFt: ${site.sqft.toLocaleString()}`         : null,
    site.price  ? `List Price: $${site.price.toLocaleString()}` : null,
    site.mls    ? `MLS#: ${site.mls}`                           : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are a social media strategist writing stop-scroll, curiosity-driven Instagram Reel scripts for real estate agents at Builds 'n Lenses Media in Scottsdale, AZ.

## Core Philosophy
- Pattern interrupts: disrupt the scroll in the first 2 seconds
- Curiosity gaps: create an information gap the viewer must close
- Social proof & FOMO: make them feel something is slipping away
- Conversational specificity: specific details feel real; vague claims feel like ads

The script is NOT a brochure read aloud. It's a conversation that makes someone stop, feel something, and want to see more.

## Property Details
${details}

## Script Format (each script)
[HOOK] — 0–3 seconds. One punchy line. No intro. No "Hey guys." No "Welcome to."
[BRIDGE] — 3–8 seconds. Set the scene or build tension.
[FEATURES] — 8–20 seconds. 3–4 specific details, spoken conversationally. Not a list.
[CTA] — Last 3–5 seconds. One clear action. Soft urgency.

Total length: 25–40 seconds / ~65–90 words.

## Hook Rules
DO: Start mid-thought ("Okay, you NEED to see this backyard."), ask a gap-creating question, make a bold specific claim, use contrast ("Looks like every other house on the street. Walk inside.")
NEVER: "Welcome to this beautiful home..." / "Today we're touring..." / vague adjectives without specifics / starting with the address

## Feature Rules
Don't list — paint the picture. Not "3-car garage" but "3-car garage — room for the cars AND the gear."

## Hook Angles (pick 3 different ones)
- The Reveal: wow-factor not obvious from outside
- The Price Drop / Value: exceptional value or investor play
- The Lifestyle: sells a dream — pool, views, location
- The Scarcity: rare find, won't last
- The Curiosity Gap: provocative question or surprising fact
- The Contrast: "From the street it looks like X — inside it's Y"

## CTA Rules
Preferred: "Link in bio to see the full tour" / "DM me [price] for details" / "Tour link in bio — it goes fast"
Never: "Contact me for more info"

## Output Format

OPTION 1 — [Hook Angle Label]
---
[script — exactly what the agent says]

Approx. read time: ~X seconds

---

OPTION 2 — [Hook Angle Label]
---
[script]

Approx. read time: ~X seconds

---

OPTION 3 — [Hook Angle Label]
---
[script]

Approx. read time: ~X seconds

---

RECOMMENDATION: [One sentence — which option and why]

Write all 3 options now using the actual property data above. Use real details — no placeholder brackets.`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ── Gmail Mailer ──────────────────────────────────────────────────────────────

async function sendEmail(site: HdphSite, scripts: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const address    = site.address;
  const agentName  = site.user.name || "";
  const firstName  = agentName.split(" ")[0] || "there";
  const agentEmail = site.user.email;

  // Format scripts into clean HTML blocks
  const scriptBlocks = scripts
    .split(/\n---\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const htmlScripts = scriptBlocks.map((block) => {
    if (block.startsWith("RECOMMENDATION")) {
      return `<p style="margin-top:20px;font-style:italic;color:#555;font-size:13px">${block}</p>`;
    }
    const lines = block.split("\n");
    const title = lines[0] ?? "";
    const body  = lines.slice(2).join("\n").trim();
    return `
      <div style="background:#fff;border:1px solid #dde;border-radius:6px;padding:18px 20px;margin:16px 0">
        <h3 style="margin:0 0 10px;font-size:14px;color:#1a1a2e;font-weight:600">${title}</h3>
        <p style="margin:0;line-height:1.75;white-space:pre-wrap;font-size:14px;color:#333">${body}</p>
      </div>`;
  }).join("");

  const htmlBody = `
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#222">
  <div style="background:#111827;padding:20px 28px;border-radius:8px 8px 0 0">
    <p style="color:#fff;margin:0;font-size:16px;font-weight:600">🎬 Reel Scripts — ${address}</p>
    <p style="color:#9ca3af;margin:6px 0 0;font-size:12px">Builds 'n Lenses Media</p>
  </div>
  <div style="background:#f9fafb;padding:24px 28px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none">
    <p style="margin:0 0 16px">Hi ${firstName},</p>
    <p style="margin:0 0 20px">Put together 3 script options for <strong>${address}</strong> — each with a different hook angle. Let me know what resonates or if you want to tweak anything.</p>

    ${htmlScripts}

    <p style="margin-top:28px;margin-bottom:4px;font-size:14px">Let me know what you think, looking forward to your comments!</p>
    <br>
    <p style="margin:0;font-size:13px;color:#374151;line-height:1.6">
      Assaf Lowenstein<br>
      Builds 'n lenses media | Scottsdale | 928.970.5060 | @buildsnlensesmedia
    </p>
  </div>
</div>`;

  const textBody = `Hi ${firstName},

Put together 3 script options for ${address} — each with a different hook angle. Let me know what resonates or if you want to tweak anything.

${scripts}

Let me know what you think, looking forward to your comments!

Assaf Lowenstein
Builds 'n lenses media | Scottsdale | 928.970.5060 | @buildsnlensesmedia`;

  await transporter.sendMail({
    from: `"Builds 'n Lenses Media" <${GMAIL_USER}>`,
    to: agentEmail,
    bcc: GMAIL_USER,
    subject: `Reel Scripts — ${address}`,
    html: htmlBody,
    text: textBody,
  });

  console.log(`✉️  Sent to ${agentEmail} (${agentName}) for ${address}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Fetching sites from HDPhotoHub…");
  const sites = await fetchSites();
  console.log(`   ${sites.length} sites total`);

  const candidates = sites.filter(
    (s) => withinWindow(s.created, WINDOW_DAYS) && hasAgentOnCamera(s)
  );
  console.log(`   ${candidates.length} new agent-on-camera orders in last ${WINDOW_DAYS} days`);

  if (candidates.length === 0) {
    console.log("✅ Nothing to process today.");
    return;
  }

  const store = loadProcessed();
  const processedSet = new Set(store.processedSids);

  let sent = 0;
  let skipped = 0;

  for (const site of candidates) {
    if (processedSet.has(site.sid)) {
      console.log(`   ↩  Skipping SID ${site.sid} — already emailed`);
      skipped++;
      continue;
    }

    console.log(`\n📝 Generating scripts for SID ${site.sid} — ${site.address}…`);
    try {
      const scripts = await generateScripts(site);
      console.log(`   Generated. Sending to ${site.user.email}…`);
      await sendEmail(site, scripts);

      processedSet.add(site.sid);
      store.processedSids.push(site.sid);
      saveProcessed(store);
      sent++;
    } catch (err) {
      console.error(`   ❌ Failed for SID ${site.sid}:`, err);
    }
  }

  console.log(`\n✅ Done. Sent: ${sent}, Skipped (already processed): ${skipped}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
