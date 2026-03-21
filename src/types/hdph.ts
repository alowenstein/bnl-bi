export interface HdphMedia {
  mid: number;
  type: "still" | "video" | "floorplan" | "embed" | "pan360" | "pan" | "attachment";
  name: string;
  hidden: boolean;
  highlight: boolean;
  extension: string;
  size: number;
  url: string;
  embedurl?: string;
  download?: string;
  thumb?: string;
  order: number;
  branded: string;
}

export interface HdphGroup {
  gid: number;
  bid: number;
  name: string;
  status: "active" | "inactive";
}

export interface HdphUser {
  uid: number;
  bid: number;
  name: string;
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  website?: string;
  status: "active" | "inactive";
  type: string;
  group?: HdphGroup;
  keyring: string;
}

export interface HdphSite {
  sid: number;
  bid: number;
  status: "active" | "inactive";
  purchased: "yes" | "no" | "delivery only";
  user: HdphUser;
  couser?: HdphUser;
  address: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  lotsize?: string;
  garage?: number;
  yearbuilt?: number;
  mls?: string;
  price?: number; // MLS listing price — not our invoice
  banner?: string;
  description?: string;
  created: string; // "M/D/YYYY H:MM:SS AM/PM"
  activated?: string;
  media: HdphMedia[];
  unpaid?: number;
  unpaidall?: number;
  foreign?: Record<string, unknown>;
}

// Derived types used across the app

export type ServiceType =
  | "Photos"
  | "Floor Plan"
  | "Drone/Aerial"
  | "Video"
  | "Video Embed"
  | "3D Tour";

export interface BundleCount {
  bundle: string; // e.g. "Photos + Floor Plan + Drone"
  services: ServiceType[];
  count: number;
  pct: number;
}

export interface ServiceCount {
  service: ServiceType;
  count: number;
  pct: number;
}

export interface MonthlyVolume {
  month: string; // "YYYY-MM"
  label: string; // "Jan 2026"
  count: number;
}

export interface ClientActivity {
  uid: number;
  name: string;
  email: string;
  group?: string;
  siteCount: number;
  lastSite?: string;
}

export type PackageTier = "Gold" | "Silver" | "Bronze" | "À La Carte";

export interface PackageStat {
  tier: PackageTier;
  count: number;
  pct: number;
}

export interface UpgradeRate {
  tier: PackageTier;
  total: number;
  agentOnCamera: number;
  additionalPhotos: number;
  agentOnCameraPct: number;
  additionalPhotosPct: number;
}
