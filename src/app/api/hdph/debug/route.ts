import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";

export async function GET() {
  const sites = await hdphFetch<unknown[]>("/sites");
  // Return the most recent site raw so we can see all fields
  return NextResponse.json(sites?.[0] ?? null);
}
