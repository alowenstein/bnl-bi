// Server-side only — never import this from client components
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache — bypasses Next.js 2MB fetch cache limit (HDPH /sites is ~8MB)
const memCache = new Map<string, { data: unknown; ts: number; inflight?: Promise<unknown> }>();

function getConfig() {
  const apiKey = process.env.HDPH_API_KEY;
  const baseUrl = process.env.HDPH_BASE_URL;
  if (!apiKey) throw new Error("HDPH_API_KEY env var is not set");
  if (!baseUrl) throw new Error("HDPH_BASE_URL env var is not set");
  return { apiKey, baseUrl };
}

export async function hdphFetch<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const { apiKey, baseUrl } = getConfig();
  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const key = url.toString();

  // Return cached data if fresh
  const cached = memCache.get(key);
  if (cached) {
    if (Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data as T;
    }
    // Stale — fall through to re-fetch, but coalesce concurrent requests
    if (cached.inflight) {
      return cached.inflight as Promise<T>;
    }
  }

  // Coalesce: if a fetch is already in-flight for this key, wait for it
  const fetchPromise = (async () => {
    const res = await fetch(key, {
      headers: {
        api_key: apiKey,
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`HDPhotoHub API error ${res.status} on ${path}`);
    }

    const text = await res.text();
    const data: T = text ? (JSON.parse(text) as T) : ([] as unknown as T);

    memCache.set(key, { data, ts: Date.now() });
    return data;
  })();

  // Store inflight promise so concurrent calls wait for it
  memCache.set(key, { data: cached?.data, ts: cached?.ts ?? 0, inflight: fetchPromise });

  try {
    return (await fetchPromise) as T;
  } finally {
    // Remove inflight marker (keep cached data)
    const entry = memCache.get(key);
    if (entry?.inflight === fetchPromise) {
      memCache.set(key, { data: entry.data, ts: entry.ts });
    }
  }
}
