// Server-side only — Claude-powered SMS reply generator for BNL
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const BNL_SYSTEM_PROMPT = `You are the SMS assistant for Builds 'n Lenses Media, a real estate photography company based in Scottsdale, AZ.

Services offered:
- Photography (interior + exterior)
- Floor Plans
- Drone / Aerial Photography
- Video Walkthroughs
- 3D Virtual Tours

Tone: Warm, professional, and concise. You're texting — keep replies to 1-3 short sentences max.
If you cannot answer a specific question (exact pricing, availability, scheduling), say you'll have someone follow up soon.
Never make up prices or availability — offer to connect them with a human.
Sign off naturally without a formal signature.`;

/**
 * Generate a Claude-powered SMS reply to an incoming text message.
 */
export async function generateSMSReply(incomingText: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    system: BNL_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: incomingText,
      },
    ],
  });

  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return textBlock?.text ?? "Thanks for reaching out to Builds 'n Lenses Media! We'll be in touch shortly.";
}

/**
 * Generate a Claude-powered missed-call follow-up text message.
 */
export async function generateMissedCallText(): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    system: BNL_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Generate a brief, warm missed-call follow-up text. Let them know we missed their call and invite them to text us their question or let us know a good time to call back.",
      },
    ],
  });

  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return (
    textBlock?.text ??
    "Hey! Sorry we missed your call. This is Builds 'n Lenses Media — feel free to text us your question and we'll get right back to you!"
  );
}
