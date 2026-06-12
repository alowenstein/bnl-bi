import { NextResponse } from "next/server";

const OPENPHONE_API_KEY  = (process.env.OPENPHONE_API_KEY  ?? "").trim();
const OPENPHONE_FROM_NUM = (process.env.OPENPHONE_FROM_NUM ?? "").trim();

export async function POST(req: Request) {
  if (!OPENPHONE_API_KEY || !OPENPHONE_FROM_NUM) {
    return NextResponse.json(
      { error: "OpenPhone not configured (OPENPHONE_API_KEY / OPENPHONE_FROM_NUM missing)" },
      { status: 500 }
    );
  }

  const { to, content } = (await req.json()) as {
    to: string;
    content: string;
  };

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
  return NextResponse.json({ success: true, data });
}
