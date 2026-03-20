import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";
import type { HdphSite } from "@/types/hdph";

export async function GET() {
  try {
    const sites = await hdphFetch<HdphSite[]>("/sites");
    return NextResponse.json(sites);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
