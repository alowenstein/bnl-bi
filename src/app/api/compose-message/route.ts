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

export async function POST(req: Request) {
  const { changeType, agentName, address, currentPrice, examples } =
    await req.json() as ComposeRequest;

  const firstName = agentName.trim().split(" ")[0];

  const examplesBlock = examples.length > 0
    ? "\nHere are previous messages you sent and how you improved them. Match this evolving style:\n\n" +
      examples
        .slice(-5) // most recent 5
        .map((e, i) => `Example ${i + 1}:\nOriginal: ${e.original}\nYours: ${e.edited}`)
        .join("\n\n") +
      "\n"
    : "";

  const priceNote = currentPrice && changeType === "price_change"
    ? ` The new price is $${currentPrice.toLocaleString()}.`
    : "";

  const prompt = `You write short, warm text messages from Assaf (a real estate photographer at Builds 'n Lenses Media) to agents congratulating them on a listing status change. The tone is genuine and personal — like a text from a friend in the industry. No sales pitch, no self-promotion, just a sincere congrats. Keep it 1–2 sentences max.
${examplesBlock}
Now write a message for:
- Agent: ${firstName}
- Property: ${address}
- Event: ${EVENT_LABELS[changeType]}${priceNote}

Write only the message text. No quotes.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  return NextResponse.json({ message: text });
}
