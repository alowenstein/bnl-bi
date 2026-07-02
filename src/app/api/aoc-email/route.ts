import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const anthropic = new Anthropic();

interface AocEmailRequest {
  address: string;
  city?: string;
  state?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  price?: number;
  mls?: string;
  agentName: string;
  agentEmail: string;
}

export async function POST(req: Request) {
  try {
    const body: AocEmailRequest = await req.json();
    const { address, city, state, beds, baths, sqft, price, mls, agentName, agentEmail } = body;

    const details = [
      `Address: ${address}${city ? `, ${city}` : ""}${state ? `, ${state}` : ""}`,
      beds   ? `Beds: ${beds}`                          : null,
      baths  ? `Baths: ${baths}`                        : null,
      sqft   ? `SqFt: ${sqft.toLocaleString()}`         : null,
      price  ? `List Price: $${price.toLocaleString()}` : null,
      mls    ? `MLS#: ${mls}`                           : null,
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

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const scripts = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Build email content (mirrors agent-on-camera-emailer.ts sendEmail())
    const firstName = agentName.split(" ")[0] || "there";
    const subject = `Reel Scripts — ${address}`;

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

    return Response.json({ subject, htmlBody, textBody, to: agentEmail });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
