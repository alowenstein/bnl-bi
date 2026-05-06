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
  const prev          = snap.lastStatus;
  const wasActive     = prev === "For Sale" || prev === "Unknown";
  const wasContingent = prev === "Pending" || prev === "Under Contract" || prev === "Accepting Backup Offers";

  if (wasActive && (status === "Pending" || status === "Under Contract")) return "pending";
  if (wasActive && status === "Accepting Backup Offers")                   return "backup_offers";

  // Sold and Off Market are terminal — detect from ANY prior active/contingent state
  // (Pending→Sold, Backup Offers→Sold, etc. were previously missed)
  if ((wasActive || wasContingent) && status === "Sold")                  return "sold";
  if ((wasActive || wasContingent) && status === "Off Market")            return "off_market";

  if (status === "For Sale" && (wasContingent || prev === "Off Market"))  return "back_on_market";

  if (
    status === "For Sale" &&
    prev  === "For Sale" &&
    price !== null &&
    snap.lastPrice !== null &&
    price !== snap.lastPrice
  ) return "price_change";

  return null;
}
