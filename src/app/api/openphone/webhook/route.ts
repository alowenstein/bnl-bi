import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sendSMS } from "@/lib/openphone-client";
import { generateSMSReply, generateMissedCallText } from "@/lib/text-agent";
import type { OpenPhoneWebhookEvent } from "@/types/openphone";

/**
 * Validate the OpenPhone webhook signature.
 * OpenPhone signs the raw request body with HMAC-SHA256 using the webhook secret.
 * Returns true if valid (or if no secret is configured — dev mode).
 */
function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.OPENPHONE_WEBHOOK_SECRET;
  if (!secret) return true; // Skip validation in dev when no secret is set

  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Read raw body first (needed for signature validation)
  const rawBody = await request.text();
  const signature = request.headers.get("x-openphone-signature");

  if (!isValidSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: OpenPhoneWebhookEvent;
  try {
    event = JSON.parse(rawBody) as OpenPhoneWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (event.type === "message.received") {
      const { from, to, text } = event.data.object;
      const bnlNumber = to[0]; // BNL's phone number that received the message

      const reply = await generateSMSReply(text);
      await sendSMS(from, bnlNumber, reply);

      console.log(`[openphone] Replied to SMS from ${from}: "${reply}"`);
    } else if (event.type === "call.completed") {
      const { from, to, answeredAt } = event.data.object;

      // Only act on missed calls (answeredAt is null means nobody picked up)
      if (answeredAt === null) {
        const message = await generateMissedCallText();
        await sendSMS(from, to, message);

        console.log(`[openphone] Sent missed-call follow-up to ${from}: "${message}"`);
      }
    }
    // All other event types are acknowledged with no action

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[openphone] Webhook handler error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
