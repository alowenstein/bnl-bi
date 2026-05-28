import { NextResponse } from "next/server";

const REALTYAPI_KEY  = process.env.REALTYAPI_KEY ?? "";
const REALTYAPI_BASE = "https://zillow.realtyapi.io";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * GET /api/debug/listing?address=6721+E+Ludlow+Dr+Scottsdale+AZ+85254
 *
 * Calls RealtyAPI live and returns the raw response so you can see exactly
 * what Zillow reports for any address — homeStatus, priceHistory, etc.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address")?.trim();

  if (!address || address.length > 300) {
    return NextResponse.json({ error: "Missing or invalid ?address= param" }, { status: 400 });
  }

  if (!REALTYAPI_KEY) {
    return NextResponse.json({ error: "REALTYAPI_KEY not configured" }, { status: 500 });
  }

  const url = `${REALTYAPI_BASE}/pro/byaddress?propertyaddress=${encodeURIComponent(address)}`;

  let raw: unknown;
  let httpStatus: number;

  try {
    const res = await fetch(url, {
      headers: {
        "x-realtyapi-key": REALTYAPI_KEY,
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    httpStatus = res.status;
    raw = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: "RealtyAPI fetch failed", detail: String(err) },
      { status: 502 }
    );
  }

  // Extract the key fields we care about so they're easy to spot
  const pd = (raw as { propertyDetails?: Record<string, unknown> })?.propertyDetails ?? {};
  const summary = {
    homeStatus:            pd.homeStatus,
    price:                 pd.price,
    contingentListingType: pd.contingentListingType,
    listingSubType:        pd.listingSubType,
    hdpUrl:                pd.hdpUrl,
    zpid:                  pd.zpid,
    priceHistory:          pd.priceHistory,
  };

  return NextResponse.json({
    address,
    realtyApiUrl: url,
    httpStatus,
    summary,       // key fields at a glance
    raw,           // full raw response
  });
}
