import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { hdphFetch } from "@/lib/hdph-client";
import {
  computeBundles,
  computeServiceFrequency,
  computeMonthlyVolume,
  computeSeasonality,
} from "@/lib/data-transforms";
import type { HdphSite } from "@/types/hdph";

const anthropic = new Anthropic();

export async function GET() {
  try {
    const sites = await hdphFetch<HdphSite[]>("/sites");

    const bundles = computeBundles(sites).slice(0, 10);
    const services = computeServiceFrequency(sites);
    const monthly = computeMonthlyVolume(sites, 18);
    const seasonality = computeSeasonality(sites);
    const totalSites = sites.length;
    const outstandingAR = sites.reduce((s, x) => s + (x.unpaid ?? 0), 0);

    const dataContext = `
You are a business consultant for Builds 'n Lenses Media, a real estate photography company in Scottsdale, AZ.

BUSINESS DATA SUMMARY:
- Total shoots in history: ${totalSites}
- Outstanding AR: $${outstandingAR.toFixed(2)}

SERVICE FREQUENCY (out of ${totalSites} shoots):
${services.map((s) => `  - ${s.service}: ${s.count} shoots (${s.pct}%)`).join("\n")}

TOP BUNDLES SOLD (service combinations):
${bundles.map((b, i) => `  ${i + 1}. ${b.bundle}: ${b.count} shoots (${b.pct}%)`).join("\n")}

MONTHLY VOLUME (last 18 months):
${monthly.map((m) => `  ${m.label}: ${m.count} shoots`).join("\n")}

SEASONALITY INDEX (100 = average month, >100 = above average demand):
${seasonality.map((s) => `  ${s.month}: ${s.index}`).join(", ")}
`;

    const stream = anthropic.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system: `You are a sharp business consultant specializing in real estate photography companies.
Provide concise, actionable insights. Use bullet points. Be specific with numbers.
Focus on what the business owner can actually do to grow revenue.`,
      messages: [
        {
          role: "user",
          content: `${dataContext}

Based on this data, provide a structured analysis with:

1. **Top Performing Bundles** — What's selling best and why this makes sense
2. **Pricing Opportunities** — Which services/bundles could command higher prices (seasonal or market-based)
3. **Underutilized Services** — What's undersold that could grow revenue
4. **Bundle Recommendations** — 2-3 specific new bundles to test
5. **Seasonal Strategy** — When to push which services based on the demand patterns

Be specific, reference the actual numbers, and keep it under 500 words total.`,
        },
      ],
    });

    const message = await stream.finalMessage();

    // Extract text from content blocks (skip thinking blocks)
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return NextResponse.json({ insights: text, generatedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
