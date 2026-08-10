import { NextResponse } from "next/server";
import { findContactByPhone, createContactNote } from "@/lib/ghl-client";

const OPENPHONE_API_KEY  = (process.env.OPENPHONE_API_KEY  ?? "").trim();
const OPENPHONE_FROM_NUM = (process.env.OPENPHONE_FROM_NUM ?? "").trim();

interface SendRequest {
  to: string;
  content: string;
  ghl?: {
    agentName: string;
    address: string;
    displayStatus: string;
  };
}

export async function POST(req: Request) {
  if (!OPENPHONE_API_KEY || !OPENPHONE_FROM_NUM) {
    return NextResponse.json(
      { error: "OpenPhone not configured (OPENPHONE_API_KEY / OPENPHONE_FROM_NUM missing)" },
      { status: 500 }
    );
  }

  const { to, content, ghl } = (await req.json()) as SendRequest;

  if (!to || !content) {
    return NextResponse.json({ error: "Missing to or content" }, { status: 400 });
  }

  // Normalize phone: ensure E.164 format (+1XXXXXXXXXX for US numbers)
  const toNorm = to.startsWith("+") ? to : `+1${to.replace(/\D/g, "")}`;

  const body: Record<string, unknown> = {
    from:    OPENPHONE_FROM_NUM,
    to:      [toNorm],
    content,
  };

  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization:  OPENPHONE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("OpenPhone send error:", res.status, err);

    let friendly = `Send failed (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(err) as { title?: string; message?: string };
      if (res.status === 402) {
        friendly = "Send failed — OpenPhone account is out of credits. Add funds at quo.com.";
      } else if (parsed.title || parsed.message) {
        friendly = `Send failed — ${parsed.message ?? parsed.title}`;
      }
    } catch {
      // err wasn't JSON — fall back to the generic message above
    }

    return NextResponse.json({ error: friendly }, { status: res.status });
  }

  const data = await res.json();

  // Best-effort: add a note to the agent's GHL contact record
  if (ghl && process.env.GHL_LOCATION_API_KEY) {
    const STATUS_LABELS: Record<string, string> = {
      sold: "Sold", pending: "Pending", backup_offers: "Accepting Backup Offers",
      price_change: "Price Change", off_market: "Off Market", for_sale: "For Sale",
    };
    const statusLabel = STATUS_LABELS[ghl.displayStatus] ?? ghl.displayStatus;
    const noteBody =
      `Outreach sent via OpenPhone — ${ghl.address} (${statusLabel})\n\n"${content}"`;

    findContactByPhone(to)
      .then((contact) => {
        if (contact?.id) return createContactNote(contact.id, noteBody);
      })
      .catch((err) => console.warn("GHL note failed (non-fatal):", err));
  }

  return NextResponse.json({ success: true, data });
}
