// POST /api/hdph/webhook
//
// Receives an order-created webhook from HD Photo Hub, fetches the
// associated site for address + client details, and sends an SMS
// notification via OpenPhone.
//
// Auth: Basic Auth is bypassed for this route (see middleware.ts).
//       Protect it with a secret token in the URL instead:
//         https://your-app.com/api/hdph/webhook?secret=HDPH_WEBHOOK_SECRET
//
// Required env vars:
//   OPENPHONE_API_KEY          – OpenPhone API key
//   OPENPHONE_FROM_NUM         – Your OpenPhone number (E.164)
//   ORDER_NOTIFICATION_PHONE   – Recipient number (E.164) — the photographer
//   HDPH_WEBHOOK_SECRET        – Secret token embedded in the webhook URL
//   HDPH_API_KEY / HDPH_BASE_URL – Already required by hdph-client

import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";
import type { HdphSite } from "@/types/hdph";

// ── HDPH order payload types (from /order API schema) ─────────────────────────

interface HdphOrderTask {
  tid: number;
  name: string;
  category: string;
  type: string;
  memberassigned: string;
  apptdate: string | null;
  clientpay: number;
  canceled: boolean;
  done: string;
}

interface HdphOrderPayload {
  oid: number;
  bid: number;
  sid: number;
  date: string;
  tags?: string;
  tasks: HdphOrderTask[];
  subtotal: number;
  total: number;
  invoiceurl?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`;
}

function formatAppt(tasks: HdphOrderTask[]): string | null {
  const task = tasks.find((t) => !t.canceled && t.apptdate);
  if (!task?.apptdate) return null;
  try {
    return new Date(task.apptdate).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Phoenix",
    });
  } catch {
    return task.apptdate;
  }
}

function formatServices(tasks: HdphOrderTask[]): string {
  const names = tasks.filter((t) => !t.canceled).map((t) => t.name);
  return names.length ? names.join(", ") : "—";
}

function buildSms(site: HdphSite, order: HdphOrderPayload): string {
  const client =
    site.user?.name ||
    `${site.user?.firstname ?? ""} ${site.user?.lastname ?? ""}`.trim() ||
    "Unknown client";

  const address = [site.address, site.address2].filter(Boolean).join(" ");
  const location = [address, site.city, site.state].filter(Boolean).join(", ");

  const lines = [
    "New order!",
    `Client: ${client}`,
    `Address: ${location}`,
    `Services: ${formatServices(order.tasks)}`,
  ];

  const appt = formatAppt(order.tasks);
  if (appt) lines.push(`Appt: ${appt}`);

  return lines.join("\n");
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Validate secret token
  const secret = process.env.HDPH_WEBHOOK_SECRET;
  if (secret) {
    const { searchParams } = new URL(req.url);
    if (searchParams.get("secret") !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const apiKey = process.env.OPENPHONE_API_KEY;
  const fromNum = process.env.OPENPHONE_FROM_NUM;
  const rawTo = process.env.ORDER_NOTIFICATION_PHONE;

  if (!apiKey || !fromNum) {
    return NextResponse.json(
      { error: "OpenPhone not configured (OPENPHONE_API_KEY / OPENPHONE_FROM_NUM missing)" },
      { status: 500 }
    );
  }
  if (!rawTo) {
    return NextResponse.json(
      { error: "ORDER_NOTIFICATION_PHONE env var not set" },
      { status: 500 }
    );
  }

  let order: HdphOrderPayload;
  try {
    order = (await req.json()) as HdphOrderPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!order.sid) {
    console.error("[hdph/webhook] Payload missing sid:", JSON.stringify(order));
    return NextResponse.json({ error: "Missing sid in payload" }, { status: 400 });
  }

  // Fetch full site details (address, client name, etc.)
  let site: HdphSite;
  try {
    site = await hdphFetch<HdphSite>("/site", { sid: String(order.sid) });
  } catch (err) {
    console.error(`[hdph/webhook] Failed to fetch site ${order.sid}:`, err);
    return NextResponse.json(
      { error: "Failed to fetch site from HDPH" },
      { status: 502 }
    );
  }

  const content = buildSms(site, order);
  const toNum = normalizePhone(rawTo);

  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromNum, to: [toNum], content }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[hdph/webhook] OpenPhone error:", res.status, err);
    return NextResponse.json({ error: err }, { status: res.status });
  }

  console.log(
    `[hdph/webhook] SMS sent for order ${order.oid} (site ${order.sid}, ${site.address})`
  );
  return NextResponse.json({ ok: true });
}
