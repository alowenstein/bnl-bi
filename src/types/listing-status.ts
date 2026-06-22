export type ListingStatus =
  | "For Sale"
  | "Pending"
  | "Under Contract"
  | "Accepting Backup Offers"
  | "Sold"
  | "Off Market"
  | "Unknown";

export type DisplayStatus =
  | "for_sale"
  | "price_change"
  | "pending"
  | "backup_offers"
  | "sold"
  | "off_market";

export type ChangeType =
  | "pending"
  | "backup_offers"
  | "sold"
  | "price_change"
  | "back_on_market"
  | "off_market";

export interface ListingSnapshot {
  sid: number;
  bid: number;
  address: string;
  address2: string | null;   // unit / suite / apt
  city: string;
  state: string;
  zip: string;
  mls: string | null;
  agentName: string;
  agentEmail: string;
  agentPhone: string | null;
  shotDate: string;           // from site.created
  lastChecked: string;        // ISO timestamp
  lastStatus: ListingStatus;
  lastPrice: number | null;
  listingUrl: string;
  hdphUrl: string;            // link to HDPhotoHub admin page for this shoot
  photoUrl: string | null;    // first still photo from HDPH media[]
}

export interface ListingChange {
  id: string;             // `${sid}-${detectedAt}`
  sid: number;
  address: string;
  address2: string | null;   // unit / suite / apt
  city: string;
  state: string;
  mls: string | null;
  agentName: string;
  agentEmail: string;
  agentPhone: string | null;
  changeType: ChangeType;
  previousStatus: ListingStatus;
  currentStatus: ListingStatus;
  previousPrice: number | null;
  currentPrice: number | null;
  priceDelta: number | null;  // negative = price drop
  shotDate: string;           // when the photo shoot happened (site.created)
  statusDate: string | null;  // "YYYY-MM-DD" when the status change actually occurred (from Zillow history)
  detectedAt: string;         // ISO timestamp
  listingUrl: string;
  hdphUrl: string;            // link to HDPhotoHub admin page for this shoot
  photoUrl: string | null;    // first still photo from HDPH media[]
}

export interface ListingEntry {
  id: string;              // "${sid}-${displayStatus}" for dismiss stability
  sid: number;
  address: string;
  address2: string | null;
  city: string;
  state: string;
  mls: string | null;
  agentName: string;
  agentEmail: string;
  agentPhone: string | null;
  shotDate: string;
  displayStatus: DisplayStatus;
  statusDate: string | null;
  currentPrice: number | null;
  previousPrice: number | null;        // price before the most recent price change
  originalListingPrice: number | null; // price when first listed on MLS
  priceDropCount: number;              // total price changes since original listing
  listingUrl: string;
  hdphUrl: string;
  photoUrl: string | null;
}

export interface SnapshotStore {
  lastRun: string | null;
  snapshots: Record<number, ListingSnapshot>; // keyed by sid
}

export interface ChangeLogStore {
  changes: ListingChange[]; // newest first, capped at 200
}
