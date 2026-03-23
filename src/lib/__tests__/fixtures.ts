import type { HdphSite, HdphMedia, HdphUser } from "@/types/hdph";

// ── Helpers ──────────────────────────────────────────────────────────────────

let _uid = 1;
let _mid = 1;
let _sid = 1;

export function makeUser(overrides: Partial<HdphUser> = {}): HdphUser {
  return {
    uid: _uid++,
    bid: 1,
    name: "Test Agent",
    firstname: "Test",
    lastname: "Agent",
    email: "agent@test.com",
    status: "active",
    type: "agent",
    keyring: "",
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<HdphMedia> = {}): HdphMedia {
  return {
    mid: _mid++,
    type: "still",
    name: "Photo",
    hidden: false,
    highlight: false,
    extension: "jpg",
    size: 1000,
    url: "https://example.com/photo.jpg",
    order: 0,
    branded: "yes",
    ...overrides,
  };
}

export function makeSite(overrides: Partial<HdphSite> = {}): HdphSite {
  return {
    sid: _sid++,
    bid: 1,
    status: "active",
    purchased: "yes",
    created: "3/1/2026 10:00:00 AM",
    address: "123 Main St",
    city: "Scottsdale",
    state: "AZ",
    zip: "85251",
    beds: 3,
    baths: 2,
    sqft: 1800,
    mls: "MLS123",
    price: 500000,
    user: makeUser(),
    media: [],
    unpaid: 0,
    unpaidall: 0,
    ...overrides,
  };
}

// ── Reusable media constructors ───────────────────────────────────────────────

export const photoMedia = (): HdphMedia => makeMedia({ type: "still", name: "25 HDR Photos" });
export const droneMedia = (): HdphMedia => makeMedia({ type: "still", name: "Aerial Drone Photos" });
export const twilightMedia = (): HdphMedia => makeMedia({ type: "still", name: "Twilight Photos" });
export const floorplanMedia = (): HdphMedia => makeMedia({ type: "floorplan", name: "Floor Plan" });
export const videoMedia = (): HdphMedia => makeMedia({ type: "video", name: "Listing Highlights Video" });
export const aocVideoMedia = (): HdphMedia => makeMedia({ type: "video", name: "Agent on Camera" });
export const pan360Media = (): HdphMedia => makeMedia({ type: "pan360", name: "3D Tour" });
export const panMedia = (): HdphMedia => makeMedia({ type: "pan", name: "Virtual Tour" });
export const matterportEmbedMedia = (): HdphMedia => makeMedia({ type: "embed", name: "Matterport 3D Tour" });
export const zillow3dMedia = (): HdphMedia => makeMedia({ type: "embed", name: "Zillow 3D Home" });
export const videoEmbedMedia = (): HdphMedia => makeMedia({ type: "embed", name: "Virtual Tour Embed" });
export const additionalPhotosMedia = (): HdphMedia => makeMedia({ type: "still", name: "Additional Photos" });

// ── Named package fixture sites ───────────────────────────────────────────────

export const bronzeSite = (): HdphSite =>
  makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia()] });

export const silverSite = (): HdphSite =>
  makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia(), pan360Media()] });

export const goldSite = (): HdphSite =>
  makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia(), videoMedia()] });

export const alaCarteSite = (): HdphSite =>
  makeSite({ media: [photoMedia()] });

export const emptySite = (): HdphSite =>
  makeSite({ media: [] });

export const aocSite = (): HdphSite =>
  makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia(), aocVideoMedia()] });
