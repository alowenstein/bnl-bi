// POST /api/n8n/order-sms
//
// Called by N8N when a new order is detected in HD Photo Hub.
// Builds a notification SMS and sends it via OpenPhone.
//
// Recipient priority:
//   1. `to` field in the request body  (N8N can override per-workflow)
//   2. ORDER_NOTIFICATION_PHONE env var (e.g. the business owner's number)
//   3. Returns 400 if neither is available
//
// Required env vars:
//   OPENPHONE_API_KEY       – OpenPhone API key
//   OPENPHONE_FROM_NUM      – Your OpenPhone number in E.164 format (+1XXXXXXXXXX)
//   ORDER_NOTIFICATION_PHONE – Default recipient in E.164 format (optional if `to` is sent)

import { NextResponse } from "next/server";
import type { HdphSite } from "@/types/hdph";

const OPENPHONE_API_BASE = "https://api.openphone.com/v1";

function normalizePhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`;
}

function buildSmsBody(site: HdphSite): string {
  const client = site.user
    ? site.user.name || `${site.user.firstname} ${site.user.lastname}`.trim()
    : "Unknown client";

  const address = [site.address, site.address2].filter(Boolean).join(" ");
  const location = [address, site.city, site.state].filter(Boolean).join(", ");

  return [
    "New order — HD Photo Hub",
    `Client: ${client}`,
    `Property: ${location}`,
    `Ordered: ${site.created}`,
  ].join("\n");
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENPHONE_API_KEY;
  const fromNum = process.env.OPENPHONE_FROM_NUM;

  if (!apiKey || !fromNum) {
    return NextResponse.json(
      { error: "OpenPhone not configured (OPENPHONE_API_KEY / OPENPHONE_FROM_NUM missing)" },
      { status: 500 }
    );
  }

  let body: { site?: HdphSite; to?: string } & Partial<HdphSite>;
  try {
    body = (await req.json()) as { site?: HdphSite; to?: string } & Partial<HdphSite>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Accept either { site: HdphSite, to?: string } or a bare HdphSite at the root
  const site: Partial<HdphSite> = body.site ?? (body as Partial<HdphSite>);

  if (!site.address && !site.sid) {
    return NextResponse.json(
      { error: "No HDPH site data found in request body" },
      { status: 400 }
    );
  }

  // Resolve recipient
  const rawTo =
    body.to ??
    process.env.ORDER_NOTIFICATION_PHONE ??
    "";

  if (!rawTo) {
    return NextResponse.json(
      {
        error:
          "No recipient phone number: set ORDER_NOTIFICATION_PHONE env var or pass `to` in the request body",
      },
      { status: 400 }
    );
  }

  const toNum = normalizePhone(rawTo);
  const content = buildSmsBody(site as HdphSite);

  const res = await fetch(`${OPENPHONE_API_BASE}/messages`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromNum, to: [toNum], content }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[n8n/order-sms] OpenPhone error:", res.status, err);
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = (await res.json()) as unknown;
  console.log(`[n8n/order-sms] SMS sent to ${toNum} for site ${site.sid ?? site.address}`);

  return NextResponse.json({ ok: true, to: toNum, content, data });
}
