/**
 * Pure utility functions for the listing status tracker.
 * Extracted here so they can be unit-tested independently of the HTTP route.
 */

import type { DisplayStatus, ListingEntry } from "@/types/listing-status";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZillowStatus =
  | "For Sale" | "Pending" | "Under Contract"
  | "Accepting Backup Offers" | "Sold" | "Off Market" | "For Rent" | "Unknown";

export interface PriceHistoryEntry {
  date: string;
  event: string;
  price?: number;
  postingIsRental?: boolean;
}

export interface RealtyApiResult {
  status: ZillowStatus;
  price: number | null;
  listingUrl: string;
  statusDate: string | null;
  photoUrl: string | null;
  priceHistory: PriceHistoryEntry[];
}

export interface HdphSite {
  sid: number; bid: number; created: string; status: string; activated?: string;
  address: string; address2?: string; city?: string; state?: string; zip?: string;
  mls?: string; price?: number;
  user: { name: string; email: string; phone?: string };
  media: { type: string; hidden: boolean; url?: string }[];
}

// ── Address formatting ────────────────────────────────────────────────────────

/**
 * Strip the street number and cardinal direction from an address so messages
 * read naturally: "2211 W Windrose Dr" → "Windrose Dr"
 */
export function streetName(address: string): string {
  return address
    .replace(/^\d+\s+(?:[NSEW]\s+)?/i, "")          // strip leading number + directional
    .replace(/\s+(?:unit|apt|suite|#)\s*\S+/gi, "")  // strip unit/apt suffix
    .trim();
}

// ── Phone formatting ──────────────────────────────────────────────────────────

/**
 * Normalizes a phone number to xxx.xxx.xxxx format.
 * Strips country code if present, returns original string if it can't be parsed to 10 digits.
 */
export function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const clean  = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (clean.length !== 10) return phone.trim() || null;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
}

// ── Zillow status mapping ─────────────────────────────────────────────────────

export function mapZillowStatus(
  homeStatus: string | undefined,
  subType?: Record<string, boolean> | null,
  contingentType?: string | null
): ZillowStatus {
  if (!homeStatus) return "Unknown";
  if (contingentType)     return "Accepting Backup Offers";
  if (subType?.isPending) return "Pending";
  switch (homeStatus) {
    case "FOR_SALE":      return "For Sale";
    case "PENDING":       return "Pending";
    case "SOLD":
    case "RECENTLY_SOLD": return "Sold";
    case "OTHER":         return "Off Market";
    case "FOR_RENT":      return "For Rent";
    default:              return "Unknown";
  }
}

// ── Status date lookup ────────────────────────────────────────────────────────

export function getStatusDate(
  history: PriceHistoryEntry[] | null | undefined,
  status: ZillowStatus
): string | null {
  if (!history?.length) return null;
  const keywords: Partial<Record<ZillowStatus, string[]>> = {
    "Sold":                    ["sold"],
    "Pending":                 ["pending", "pending sale", "under contract"],
    "Accepting Backup Offers": ["contingent", "backup"],
    "Off Market":              ["off market", "removed", "expired", "withdrawn"],
  };
  const keys = keywords[status] ?? [];
  const match = history.find((h) => keys.some((k) => h.event.toLowerCase().includes(k)));
  return match?.date ?? history[0]?.date ?? null;
}

// ── Photo URL helper ──────────────────────────────────────────────────────────

export function getFirstPhotoUrl(site: HdphSite): string | null {
  return site.media?.find(
    (m) => m.type === "still" && !m.hidden && m.url && !m.url.endsWith("/z.jpg")
  )?.url ?? null;
}

// ── Price change detection ────────────────────────────────────────────────────

/**
 * Searches priceHistory (newest-first) for a "price change" event on or after
 * the shoot date. Returns the event date + the older price entry.
 */
export function detectPriceChange(
  priceHistory: PriceHistoryEntry[],
  shootDate: string,
): { statusDate: string; previousPrice: number | null } | null {
  const shootMs = new Date(shootDate).getTime();
  const idx = priceHistory.findIndex(
    (h) =>
      h.event.toLowerCase().includes("price change") &&
      new Date(h.date).getTime() >= shootMs
  );
  if (idx === -1) return null;
  const prevEntry = priceHistory[idx + 1]; // older entry (array is newest-first)
  return {
    statusDate:    priceHistory[idx].date,
    previousPrice: prevEntry?.price ?? null,
  };
}

// ── Core listing determination ────────────────────────────────────────────────

const DISPLAY_STATUS_MAP: Partial<Record<ZillowStatus, DisplayStatus>> = {
  "Pending":                 "pending",
  "Under Contract":          "pending",
  "Accepting Backup Offers": "backup_offers",
  "Sold":                    "sold",
  "Off Market":              "off_market",
};

/**
 * Given one HDPH site and its RealtyAPI result, determine the DisplayStatus and
 * build the ListingEntry. Returns null if the listing should be excluded — e.g.
 * the status event occurred before the shoot date (pre-existing condition).
 */
export function determineListing(
  site: HdphSite,
  result: RealtyApiResult,
  hdphUrl: string,
): ListingEntry | null {
  const { status, price, listingUrl, statusDate, photoUrl: zillowPhoto } = result;
  const shootDate = site.created;
  const shootMs   = new Date(shootDate).getTime();
  const photoUrl  = getFirstPhotoUrl(site) ?? zillowPhoto;

  // For Sale or Unknown — check for a price change since the shoot date
  if (status === "For Sale" || status === "Unknown") {
    const priceChange   = detectPriceChange(result.priceHistory, shootDate);
    const displayStatus: DisplayStatus = priceChange ? "price_change" : "for_sale";
    return {
      id:            `${site.sid}-${displayStatus}`,
      sid:           site.sid,
      address:       site.address,
      address2:      site.address2?.trim() || null,
      city:          site.city   ?? "",
      state:         site.state  ?? "",
      mls:           site.mls    ?? null,
      agentName:     site.user.name,
      agentEmail:    site.user.email,
      agentPhone:    formatPhone(site.user.phone),
      shotDate:      shootDate,
      displayStatus,
      statusDate:    priceChange?.statusDate ?? null,
      currentPrice:  price,
      previousPrice: priceChange?.previousPrice ?? null,
      listingUrl,
      hdphUrl,
      photoUrl,
    };
  }

  // For all other statuses: exclude if the status event pre-dates our shoot
  if (statusDate && new Date(statusDate).getTime() < shootMs) return null;

  const displayStatus = DISPLAY_STATUS_MAP[status];
  if (!displayStatus) return null;

  return {
    id:            `${site.sid}-${displayStatus}`,
    sid:           site.sid,
    address:       site.address,
    address2:      site.address2?.trim() || null,
    city:          site.city   ?? "",
    state:         site.state  ?? "",
    mls:           site.mls    ?? null,
    agentName:     site.user.name,
    agentEmail:    site.user.email,
    agentPhone:    formatPhone(site.user.phone),
    shotDate:      shootDate,
    displayStatus,
    statusDate,
    currentPrice:  price,
    previousPrice: null,
    listingUrl,
    hdphUrl,
    photoUrl,
  };
}
