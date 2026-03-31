import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { ChangeLogStore } from "@/types/listing-status";

const CHANGE_LOG_FILE = path.join(process.cwd(), "data/listing-change-log.json");

export async function GET() {
  try {
    if (!fs.existsSync(CHANGE_LOG_FILE)) {
      return NextResponse.json({ changes: [] });
    }
    const raw   = fs.readFileSync(CHANGE_LOG_FILE, "utf-8");
    const store = JSON.parse(raw) as ChangeLogStore;
    return NextResponse.json({ changes: store.changes.slice(0, 50) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
