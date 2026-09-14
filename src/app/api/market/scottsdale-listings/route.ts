/**
 * GET /api/market/scottsdale-listings
 *
 * Returns for-sale listings across all Scottsdale zip codes where:
 *   - Listing price >= $1,000,000
 *   - Days on market >= 60
 *   - Includes agent name, phone, email where available
 *
 * Source: Realtor.com via RealtyAPI
 *
 * Query params:
 *   ?limit=10          Max results total (default 10)
 *   ?minPrice=1000000
 *   ?minDays=60
 */

import { NextResponse } from "next/server";

const REALTYAPI_KEY  = process.env.REALTYAPI_KEY ?? "";
const REALTYAPI_BASE = "https://realtor.realtyapi.io";
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
  address:      string;
  zip:          string;
  city:         string;
  state:        string;
  price:        number;
  beds:         number | null;
  baths:        number | null;
  sqft:         number | null;
  daysOnMarket: number | null;
  status:       string;
  listingUrl:   string;
  photoUrl:     string | null;
  agent:        AgentInfo;
  mls:          string | null;
  listedDate:   string | null;
}

async function searchZip(
  zip: string,
  minPrice: number,
  minDays: number,
  limit: number,
): Promise<Listing[]> {
  const params = new URLSearchParams({
    postal_code:         zip,
    status:              "for_sale",
    list_price_min:      String(minPrice),
    days_on_market_min:  String(minDays),
    limit:               String(limit),
    sort:                "days_on_market",
    sort_dir:            "desc",
  });

  const url = `${REALTYAPI_BASE}/properties/search?${params}`;

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
    throw new Error(`RealtyAPI ${res.status} for zip ${zip}: ${body.slice(0, 300)}`);
  }

  const json = await res.json() as Record<string, unknown>;

  // Realtor.com via RealtyAPI returns results under different keys
  const props = (
    json.properties ??
    json.results    ??
    json.listings   ??
    json.data       ??
    []
  ) as Record<string, unknown>[];

  return props.slice(0, limit).map((p): Listing => {
    const loc     = (p.location   ?? p.address ?? {}) as Record<string, unknown>;
    const agent   = (p.list_agent ?? p.agent   ?? p.listingAgent ?? {}) as Record<string, unknown>;
    const desc    = (p.description ?? {}) as Record<string, unknown>;
    const address = (loc.address   ?? loc.line  ?? p.address ?? p.street_address ?? "") as string;

    return {
      address,
      zip,
      city:         String(loc.city  ?? p.city  ?? "Scottsdale"),
      state:        String(loc.state ?? p.state ?? "AZ"),
      price:        Number(p.list_price ?? p.price ?? desc.list_price ?? 0),
      beds:         (p.beds ?? desc.beds   ?? p.bedrooms  ?? null) != null
                      ? Number(p.beds ?? desc.beds ?? p.bedrooms) : null,
      baths:        (p.baths ?? desc.baths ?? p.bathrooms ?? null) != null
                      ? Number(p.baths ?? desc.baths ?? p.bathrooms) : null,
      sqft:         (p.sqft ?? desc.sqft ?? p.living_area ?? null) != null
                      ? Number(p.sqft ?? desc.sqft ?? p.living_area) : null,
      daysOnMarket: (p.days_on_market ?? p.dom ?? null) != null
                      ? Number(p.days_on_market ?? p.dom) : null,
      status:       String(p.status ?? p.list_date ?? "for_sale"),
      listingUrl:   String(p.href ?? p.url ?? p.detail_url ?? ""),
      photoUrl:     (p.primary_photo ?? p.photo ?? p.imgSrc ?? null) as string | null,
      agent: {
        name:  (agent.name  ?? agent.full_name  ?? null) as string | null,
        phone: (agent.phone ?? agent.contact    ?? null) as string | null,
        email: (agent.email ?? null) as string | null,
      },
      mls:        (p.mls_id  ?? p.mls   ?? null) as string | null,
      listedDate: (p.list_date ?? p.listed_date ?? null) as string | null,
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

  const allListings: Listing[] = [];
  const errors: { zip: string; error: string }[] = [];

  for (const zip of SCOTTSDALE_ZIPS) {
    if (allListings.length >= limit) break;

    try {
      const listings = await searchZip(zip, minPrice, minDays, limit - allListings.length);
      allListings.push(...listings);
    } catch (err) {
      errors.push({ zip, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    total:    allListings.length,
    source:   "realtor.com via RealtyAPI",
    criteria: { minPrice, minDays, limit },
    listings: allListings,
    ...(errors.length > 0 && { errors }),
  });
}
