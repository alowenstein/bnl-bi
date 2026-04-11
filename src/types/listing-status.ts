export type ListingStatus =
  | "For Sale"
  | "Pending"
  | "Under Contract"
  | "Accepting Backup Offers"
  | "Sold"
  | "Off Market"
  | "Unknown";

export type ChangeType =
  | "pending"
  | "backup_offers"
  | "sold"
  | "price_change"
  | "back_on_market"
  | "off_market";

export interface ListingSnapshot {
  sid: number;
  address: string;
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
  photoUrl: string | null;    // first still photo from HDPH media[]
}

export interface ListingChange {
  id: string;             // `${sid}-${detectedAt}`
  sid: number;
  address: string;
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
  detectedAt: string;         // ISO timestamp
  listingUrl: string;
  photoUrl: string | null;    // first still photo from HDPH media[]
}

export interface SnapshotStore {
  lastRun: string | null;
  snapshots: Record<number, ListingSnapshot>; // keyed by sid
}

export interface ChangeLogStore {
  changes: ListingChange[]; // newest first, capped at 200
}
