import { NextResponse } from "next/server";
import { hdphFetch } from "@/lib/hdph-client";
import type { HdphUser } from "@/types/hdph";

export async function GET() {
  try {
    const users = await hdphFetch<HdphUser[]>("/users");
    return NextResponse.json(users);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
