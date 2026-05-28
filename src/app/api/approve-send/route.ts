/**
 * GET /api/approve-send?token=<signed-token>
 *
 * One-click "Approve All & Send Texts" endpoint linked from the weekly digest email.
 * Validates the HMAC-signed token, sends all texts via OpenPhone, and returns an
 * HTML confirmation page with a link back to the dashboard.
 *
 * Must be a GET (HTML email buttons are links, not form POSTs).
 */

import * as crypto from "crypto";
import type { SendJob } from "@/app/api/weekly-digest/route";

const OPENPHONE_API_KEY  = (process.env.OPENPHONE_API_KEY  ?? "").trim();
const OPENPHONE_FROM_NUM = (process.env.OPENPHONE_FROM_NUM ?? "").trim();
const DIGEST_SECRET      = process.env.DIGEST_SECRET       ?? "";
const APP_URL            = process.env.NEXT_PUBLIC_APP_URL ?? "https://bnl-bi.vercel.app";

// ── Token validation ──────────────────────────────────────────────────────────

interface TokenPayload { jobs: SendJob[]; exp: number }

function parseToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", DIGEST_SECRET).update(payload).digest("hex");
  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenPayload; }
  catch { return null; }
}

// ── OpenPhone send ────────────────────────────────────────────────────────────

async function sendText(job: SendJob): Promise<"ok" | "skip" | "error"> {
  if (!job.phone) return "skip";
  const toNorm = job.phone.startsWith("+") ? job.phone : `+1${job.phone.replace(/\D/g, "")}`;
  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: { Authorization: OPENPHONE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: OPENPHONE_FROM_NUM, to: [toNorm], content: job.message }),
  });
  if (!res.ok) { console.error("OpenPhone error:", res.status, await res.text()); return "error"; }
  return "ok";
}

// ── HTML responses ────────────────────────────────────────────────────────────

function htmlPage(title: string, heading: string, body: string, showDashboard = true): Response {
  const dashBtn = showDashboard
    ? `<a href="${APP_URL}" style="display:inline-block;margin-top:20px;background:#111;color:#fff;font-size:14px;font-weight:500;padding:12px 28px;border-radius:8px;text-decoration:none;">Open Dashboard →</a>`
    : "";
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title></head>
    <body style="margin:0;padding:60px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;background:#f9fafb;">
      <div style="max-width:480px;margin:0 auto;">
        <h1 style="font-size:28px;font-weight:700;color:#111;margin-bottom:12px;">${heading}</h1>
        <p style="font-size:16px;color:#6b7280;line-height:1.6;">${body}</p>
        ${dashBtn}
      </div>
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");

  if (!token) {
    return htmlPage("Invalid link", "⚠️ Invalid link", "This link is missing a token. Please use the link from your weekly digest email.", false);
  }

  if (!DIGEST_SECRET) {
    return htmlPage("Configuration error", "⚠️ Server error", "DIGEST_SECRET is not configured.", false);
  }

  // Validate signature — DIGEST_SECRET hex must be 64 chars (32 bytes) for timingSafeEqual
  const payload = parseToken(token);
  if (!payload) {
    return htmlPage("Invalid token", "🚫 Invalid or tampered link", "This link could not be verified. Please use the original link from your email.", false);
  }

  if (Date.now() > payload.exp) {
    return htmlPage("Link expired", "⏰ Link expired", "This link expired after 7 days. Run a manual digest refresh from the dashboard to get a fresh link.", true);
  }

  if (!OPENPHONE_API_KEY || !OPENPHONE_FROM_NUM) {
    return htmlPage("Config error", "⚠️ OpenPhone not configured", "Missing OpenPhone credentials — texts cannot be sent.", false);
  }

  const { jobs } = payload;
  if (!jobs?.length) {
    return htmlPage("Nothing to send", "✅ Nothing to send", "There were no texts to send in this digest.", true);
  }

  // Send all texts in parallel
  const results = await Promise.allSettled(jobs.map(sendText));
  const sent    = results.filter((r) => r.status === "fulfilled" && r.value === "ok").length;
  const skipped = results.filter((r) => r.status === "fulfilled" && r.value === "skip").length;
  const errors  = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === "error")).length;

  const summary = [
    sent    > 0 ? `${sent} text${sent !== 1 ? "s" : ""} sent`      : "",
    skipped > 0 ? `${skipped} skipped (no phone)`                   : "",
    errors  > 0 ? `${errors} failed`                                : "",
  ].filter(Boolean).join(" · ");

  return htmlPage(
    "Texts sent!",
    "✅ Texts sent!",
    `${summary}. Your agents have been notified.`,
    true,
  );
}
