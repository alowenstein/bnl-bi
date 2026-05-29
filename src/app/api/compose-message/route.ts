import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { DisplayStatus } from "@/types/listing-status";
import { streetName } from "@/lib/listing-utils";

const client = new Anthropic();

export interface MessageEdit {
  changeType: DisplayStatus;
  original: string;
  edited: string;
  savedAt: string;
}

interface ComposeRequest {
  changeType: DisplayStatus;
  agentName: string;
  address: string;
  currentPrice?: number | null;
  examples: MessageEdit[];
}

const EVENT_LABELS: Record<DisplayStatus, string> = {
  sold:           "sold / closed",
  pending:        "went pending / under contract",
  backup_offers:  "went contingent",
  price_change:   "had a price reduction",
  off_market:     "went off market",
  for_sale:       "is still for sale",
};


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

  const priceChangeHint = changeType === "price_change"
    ? " Assaf is a real estate photographer. For a price drop, lead with a genuine question about how they plan to market the new price — then offer to brainstorm or jump on a quick call. Don't pitch anything specific. Keep it conversational, like a colleague reaching out. Do NOT mention new photo shoots."
    : "";

  const prompt = `You write text messages from Assaf, a real estate photographer in Scottsdale AZ, to the agent whose listing just changed status. Assaf is friendly and direct — he texts like a colleague, not a marketer. No opener like "Hi [name]," unless it feels natural. No emojis unless the example style uses them. No self-promotion. One or two short sentences max.${priceChangeHint}
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
