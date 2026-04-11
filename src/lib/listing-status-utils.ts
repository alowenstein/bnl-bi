import type {
  ListingStatus,
  ChangeType,
  ListingSnapshot,
} from "../types/listing-status";

export function mapSparkStatus(standardStatus: string): ListingStatus {
  switch (standardStatus) {
    case "Active":              return "For Sale";
    case "ActiveUnderContract": return "Accepting Backup Offers";
    case "Pending":             return "Pending";
    case "Closed":              return "Sold";
    case "Withdrawn":
    case "Expired":
    case "Canceled":            return "Off Market";
    default:                    return "Unknown";
  }
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
