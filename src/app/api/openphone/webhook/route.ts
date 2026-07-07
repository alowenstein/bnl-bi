import { NextResponse } from "next/server";

// Auto-replies handled by Quo — this endpoint exists only to acknowledge
// OpenPhone webhook deliveries without error.
export async function POST() {
  return NextResponse.json({ ok: true });
}
