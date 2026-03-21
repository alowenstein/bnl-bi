import Anthropic from "@anthropic-ai/sdk";
import { hdphFetch } from "@/lib/hdph-client";
import {
  computeBundles,
  computeServiceFrequency,
  computeMonthlyVolume,
  computeSeasonality,
} from "@/lib/data-transforms";
import type { HdphSite } from "@/types/hdph";

export const maxDuration = 60;

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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const anthropicStream = anthropic.messages.stream({
            model: "claude-opus-4-6",
            max_tokens: 2000,
            system: "You are a sharp business consultant specializing in real estate photography companies. Provide concise, actionable insights. Use bullet points. Be specific with numbers. Focus on what the business owner can actually do to grow revenue.",
            messages: [
              {
                role: "user",
                content: dataContext + "\n\nBased on this data, provide a structured analysis with:\n\n1. **Top Performing Bundles** — What's selling best and why this makes sense\n2. **Pricing Opportunities** — Which services/bundles could command higher prices (seasonal or market-based)\n3. **Underutilized Services** — What's undersold that could grow revenue\n4. **Bundle Recommendations** — 2-3 specific new bundles to test\n5. **Seasonal Strategy** — When to push which services based on the demand patterns\n\nBe specific, reference the actual numbers, and keep it under 500 words total.",
              },
            ],
          });

          for await (const event of anthropicStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(encoder.encode("\n\nERROR: " + msg));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Generated-At": new Date().toISOString(),
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
