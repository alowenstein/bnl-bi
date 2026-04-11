import { NextResponse } from "next/server";
import { loadChangeLog } from "@/lib/listing-store";

export async function GET() {
  try {
    const store = await loadChangeLog();
    return NextResponse.json({ changes: store.changes.slice(0, 50) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
