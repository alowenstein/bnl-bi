/**
 * GET /api/market/scottsdale-listings
 *
 * Returns up to 10 for-sale listings per Scottsdale zip code where:
 *   - Listing price >= $1,000,000
 *   - Days on market >= 60
 *   - Includes agent name, phone, email where available
 *
 * Query params:
 *   ?limit=10        Max results per zip (default 10)
 *   ?minPrice=1000000
 *   ?minDays=60
 */

import { NextResponse } from "next/server";

const REALTYAPI_KEY  = process.env.REALTYAPI_KEY ?? "";
const REALTYAPI_BASE = "https://zillow.realtyapi.io";
const BROWSER_UA     =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const SCOTTSDALE_ZIPS = [
  "85250", "85251", "85252", "85253", "85254", "85255",
  "85256", "85257", "85258", "85259", "85260", "85261",
  "85262", "85266", "85267", "85268", "85269", "85271",
  "85054",
];

interface AgentInfo {
  name:  string | null;
  phone: string | null;
  email: string | null;
}

interface Listing {
  address:    string;
  zip:        string;
  city:       string;
  state:      string;
  price:      number;
  beds:       number | null;
  baths:      number | null;
  sqft:       number | null;
  daysOnMarket: number | null;
  status:     string;
  listingUrl: string;
  photoUrl:   string | null;
  agent:      AgentInfo;
  mls:        string | null;
}

async function searchZip(
  zip: string,
  minPrice: number,
  minDays: number,
  limit: number,
): Promise<Listing[]> {
  const params = new URLSearchParams({
    location:    zip,
    status_type: "ForSale",
    minPrice:    String(minPrice),
    daysOnZillow: String(minDays),
    limit:       String(limit),
  });

  const url = `${REALTYAPI_BASE}/pro/search?${params}`;

  const res = await fetch(url, {
    headers: {
      "x-realtyapi-key": REALTYAPI_KEY,
      "User-Agent":      BROWSER_UA,
      Accept:            "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    cache:  "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RealtyAPI ${res.status} for zip ${zip}: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as Record<string, unknown>;

  // RealtyAPI wraps results in different shapes — handle both
  const props: Record<string, unknown>[] =
    (json.props ?? json.results ?? json.listings ?? []) as Record<string, unknown>[];

  return props.slice(0, limit).map((p): Listing => {
    const agent = (p.listingAgent ?? p.agent ?? {}) as Record<string, unknown>;
    return {
      address:      String(p.address ?? p.streetAddress ?? ""),
      zip:          zip,
      city:         String(p.city ?? "Scottsdale"),
      state:        String(p.state ?? "AZ"),
      price:        Number(p.price ?? p.listPrice ?? 0),
      beds:         p.bedrooms != null ? Number(p.bedrooms) : null,
      baths:        p.bathrooms != null ? Number(p.bathrooms) : null,
      sqft:         p.livingArea != null ? Number(p.livingArea) : null,
      daysOnMarket: p.daysOnZillow != null ? Number(p.daysOnZillow) : null,
      status:       String(p.homeStatus ?? p.status ?? ""),
      listingUrl:   p.detailUrl
        ? `https://www.zillow.com${p.detailUrl}`
        : String(p.url ?? ""),
      photoUrl:     (p.imgSrc ?? p.photoUrl ?? null) as string | null,
      agent: {
        name:  (agent.name  ?? null) as string | null,
        phone: (agent.phone ?? null) as string | null,
        email: (agent.email ?? null) as string | null,
      },
      mls: (p.mlsId ?? p.mls ?? null) as string | null,
    };
  });
}

export async function GET(req: Request) {
  if (!REALTYAPI_KEY) {
    return NextResponse.json({ error: "REALTYAPI_KEY not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const minPrice = Number(searchParams.get("minPrice") ?? 1_000_000);
  const minDays  = Number(searchParams.get("minDays")  ?? 60);
  const limit    = Number(searchParams.get("limit")    ?? 10);

  const results: { zip: string; listings: Listing[]; error?: string }[] = [];

  for (const zip of SCOTTSDALE_ZIPS) {
    try {
      const listings = await searchZip(zip, minPrice, minDays, limit);
      if (listings.length > 0) {
        results.push({ zip, listings });
      }
    } catch (err) {
      results.push({ zip, listings: [], error: (err as Error).message });
    }
  }

  const allListings = results.flatMap((r) => r.listings);
  const errors      = results.filter((r) => r.error);

  return NextResponse.json({
    total:    allListings.length,
    criteria: { minPrice, minDays, limit },
    listings: allListings,
    errors:   errors.length > 0 ? errors : undefined,
  });
}
