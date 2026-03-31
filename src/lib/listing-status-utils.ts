import type {
  ListingStatus,
  ChangeType,
  ListingSnapshot,
} from "@/types/listing-status";

export function buildZillowUrl(site: {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
}): string {
  const slug = [site.address, site.city, site.state, site.zip]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return `https://www.zillow.com/homes/${slug}_rb/`;
}

export function parseZillowStatus(md: string): ListingStatus {
  const t = md.toLowerCase();
  if (t.includes("accepting backup"))                                              return "Accepting Backup Offers";
  if (t.includes("under contract"))                                                return "Under Contract";
  if (t.includes("pending"))                                                       return "Pending";
  if (t.includes("sold on") || t.includes("this home sold") || t.includes("sale price")) return "Sold";
  if (t.includes("off market") || t.includes("no longer for sale"))               return "Off Market";
  if (t.includes("for sale") || t.includes("zestimate") || t.includes("price cut")) return "For Sale";
  return "Unknown";
}

export function parseZillowPrice(md: string): number | null {
  const m =
    md.match(/\$(\d{1,3}(?:,\d{3})+)/) ??
    md.match(/\$(\d+)k\b/i) ??
    md.match(/\$(\d+(?:\.\d+)?)m\b/i);
  if (!m) return null;
  const n   = m[0].toLowerCase();
  const raw = m[1].replace(/,/g, "");
  if (n.endsWith("m")) return Math.round(parseFloat(raw) * 1_000_000);
  if (n.endsWith("k")) return Math.round(parseFloat(raw) * 1_000);
  return parseInt(raw, 10);
}

export function detectChange(
  snap: Pick<ListingSnapshot, "lastStatus" | "lastPrice">,
  status: ListingStatus,
  price: number | null
): ChangeType | null {
  const prev       = snap.lastStatus;
  const wasActive  = prev === "For Sale" || prev === "Unknown";

  if (wasActive && (status === "Pending" || status === "Under Contract")) return "pending";
  if (wasActive && status === "Accepting Backup Offers")                   return "backup_offers";
  if (wasActive && status === "Sold")                                      return "sold";
  if (wasActive && status === "Off Market")                                return "off_market";

  const wasContingent = ["Pending", "Under Contract", "Accepting Backup Offers", "Off Market"].includes(prev);
  if (status === "For Sale" && wasContingent)                              return "back_on_market";

  if (
    status === "For Sale" &&
    prev  === "For Sale" &&
    price !== null &&
    snap.lastPrice !== null &&
    price !== snap.lastPrice
  ) return "price_change";

  return null;
}
