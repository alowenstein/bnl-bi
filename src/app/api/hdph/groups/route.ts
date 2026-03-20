import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";
import type { HdphGroup } from "@/types/hdph";

export async function GET() {
  try {
    const groups = await hdphFetch<HdphGroup[]>("/groups");
    return NextResponse.json(groups);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
