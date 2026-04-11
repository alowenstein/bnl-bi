/**
 * Listing data store — Vercel KV in production, JSON file on localhost.
 *
 * KV is used when KV_REST_API_URL is set (Vercel injects this automatically
 * after you connect a KV database to the project).
 */

import type { SnapshotStore, ChangeLogStore } from "@/types/listing-status";
import * as fs from "fs";
import * as path from "path";

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USE_KV   = !!(KV_URL && KV_TOKEN);

const DATA_DIR        = path.join(process.cwd(), "data");
const SNAPSHOTS_FILE  = path.join(DATA_DIR, "listing-snapshots.json");
const CHANGE_LOG_FILE = path.join(DATA_DIR, "listing-change-log.json");

const KV_SNAPSHOTS_KEY  = "listing:snapshots";
const KV_CHANGE_LOG_KEY = "listing:change-log";

// ── KV helpers ────────────────────────────────────────────────────────────────

async function kvGet<T>(key: string): Promise<T | null> {
  const res = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const { result } = await res.json() as { result: string | null };
  if (!result) return null;
  return JSON.parse(result) as T;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value: JSON.stringify(value) }),
  });
}

// ── File helpers ──────────────────────────────────────────────────────────────

function fileRead<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function fileWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadSnapshots(): Promise<SnapshotStore> {
  if (USE_KV) {
    return (await kvGet<SnapshotStore>(KV_SNAPSHOTS_KEY)) ?? { lastRun: null, snapshots: {} };
  }
  return fileRead<SnapshotStore>(SNAPSHOTS_FILE, { lastRun: null, snapshots: {} });
}

export async function saveSnapshots(store: SnapshotStore): Promise<void> {
  if (USE_KV) {
    await kvSet(KV_SNAPSHOTS_KEY, store);
  } else {
    fileWrite(SNAPSHOTS_FILE, store);
  }
}

export async function loadChangeLog(): Promise<ChangeLogStore> {
  if (USE_KV) {
    return (await kvGet<ChangeLogStore>(KV_CHANGE_LOG_KEY)) ?? { changes: [] };
  }
  return fileRead<ChangeLogStore>(CHANGE_LOG_FILE, { changes: [] });
}

export async function saveChangeLog(store: ChangeLogStore): Promise<void> {
  if (USE_KV) {
    await kvSet(KV_CHANGE_LOG_KEY, store);
  } else {
    fileWrite(CHANGE_LOG_FILE, store);
  }
}
