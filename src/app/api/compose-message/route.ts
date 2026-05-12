import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ChangeType } from "@/types/listing-status";

const client = new Anthropic();

export interface MessageEdit {
  changeType: ChangeType;
  original: string;
  edited: string;
  savedAt: string;
}

interface ComposeRequest {
  changeType: ChangeType;
  agentName: string;
  address: string;
  currentPrice?: number | null;
  examples: MessageEdit[];
}

const EVENT_LABELS: Record<ChangeType, string> = {
  sold:           "sold / closed",
  pending:        "went pending / under contract",
  backup_offers:  "is contingent / accepting backup offers",
  back_on_market: "came back on the market",
  price_change:   "had a price change",
  off_market:     "went off market",
};

/**
 * Strip the street number and cardinal direction from an address so the
 * message reads naturally: "2211 W Windrose Dr" → "Windrose Dr"
 */
function streetName(address: string): string {
  return address.replace(/^\d+\s+(?:[NSEW]\s+)?/i, "").trim();
}

export async function POST(req: Request) {
  const { changeType, agentName, address, currentPrice, examples } =
    await req.json() as ComposeRequest;

  const firstName = agentName.trim().split(" ")[0];
  const street    = streetName(address);

  const examplesBlock = examples.length > 0
    ? "\nHere are real messages Assaf sent and then improved. Mirror this style exactly:\n\n" +
      examples
        .slice(-5)
        .map((e, i) => `Example ${i + 1}:\nDraft: ${e.original}\nSent: ${e.edited}`)
        .join("\n\n") +
      "\n"
    : "";

  const priceNote = currentPrice && changeType === "price_change"
    ? ` New price is $${currentPrice.toLocaleString()}.`
    : "";

  const prompt = `You write text messages from Assaf, a real estate photographer in Scottsdale AZ, to the agent whose listing just changed status. Assaf is friendly and direct — he texts like a colleague, not a marketer. No opener like "Hi [name]," unless it feels natural. No emojis unless the example style uses them. No self-promotion. One or two short sentences max.
${examplesBlock}
Write a message for:
- Agent first name: ${firstName}
- Street: ${street}
- What happened: ${EVENT_LABELS[changeType]}${priceNote}

Reply with only the message text.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  return NextResponse.json({ message: text });
}
