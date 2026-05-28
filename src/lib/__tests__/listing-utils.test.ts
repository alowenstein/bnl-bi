import { describe, it, expect } from "vitest";
import {
  streetName,
  mapZillowStatus,
  getStatusDate,
  determineListing,
} from "@/lib/listing-utils";
import type { HdphSite, RealtyApiResult, PriceHistoryEntry } from "@/lib/listing-utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

let _sid = 1000;

function makeSite(overrides: Partial<HdphSite> = {}): HdphSite {
  return {
    sid:     _sid++,
    bid:     1,
    created: "3/1/2026 10:00:00 AM",
    status:  "inactive",
    address: "123 W Main St",
    city:    "Scottsdale",
    state:   "AZ",
    zip:     "85251",
    user:    { name: "Jane Agent", email: "jane@example.com", phone: "6025551234" },
    media:   [{ type: "still", hidden: false, url: "https://cdn.example.com/photo.jpg" }],
    ...overrides,
  };
}

function makeResult(overrides: Partial<RealtyApiResult> = {}): RealtyApiResult {
  return {
    status:       "For Sale",
    price:        500_000,
    listingUrl:   "https://www.zillow.com/homes/123",
    statusDate:   null,
    photoUrl:     null,
    priceHistory: [],
    ...overrides,
  };
}

function makeHistory(entries: { date: string; event: string; price?: number }[]): PriceHistoryEntry[] {
  return entries;
}

const HDPH_URL = "https://order.buildsnlenses.com/Sites/summary.asp?nSiteID=1234";

// ── streetName ────────────────────────────────────────────────────────────────
// Strips leading street number + single-letter cardinal direction + unit suffix.

describe("streetName", () => {
  it("strips leading number and directional", () => {
    expect(streetName("2211 W Windrose Dr")).toBe("Windrose Dr");
  });

  it("strips leading number and E directional", () => {
    expect(streetName("6721 E Ludlow Dr")).toBe("Ludlow Dr");
  });

  it("strips number with no directional", () => {
    expect(streetName("123 Main St")).toBe("Main St");
  });

  it("strips unit suffix", () => {
    expect(streetName("9450 E Becker Ln unit 2034")).toBe("Becker Ln");
  });

  it("strips apt suffix", () => {
    expect(streetName("500 N Oak Ave apt 3B")).toBe("Oak Ave");
  });

  it("strips # suffix", () => {
    expect(streetName("100 S Palm Dr #202")).toBe("Palm Dr");
  });

  it("handles address with no directional and no unit", () => {
    expect(streetName("1541 E Las Palmaritas Dr")).toBe("Las Palmaritas Dr");
  });

  it("returns trimmed result with no leading/trailing spaces", () => {
    const result = streetName("  200 W  Camelback Rd  ");
    expect(result.startsWith(" ")).toBe(false);
    expect(result.endsWith(" ")).toBe(false);
  });
});

// ── mapZillowStatus ───────────────────────────────────────────────────────────
// Maps Zillow homeStatus API values to internal ZillowStatus.

describe("mapZillowStatus", () => {
  it("maps FOR_SALE → For Sale", () => {
    expect(mapZillowStatus("FOR_SALE")).toBe("For Sale");
  });

  it("maps PENDING → Pending", () => {
    expect(mapZillowStatus("PENDING")).toBe("Pending");
  });

  it("maps SOLD → Sold", () => {
    expect(mapZillowStatus("SOLD")).toBe("Sold");
  });

  it("maps RECENTLY_SOLD → Sold", () => {
    expect(mapZillowStatus("RECENTLY_SOLD")).toBe("Sold");
  });

  it("maps OTHER → Off Market", () => {
    expect(mapZillowStatus("OTHER")).toBe("Off Market");
  });

  it("maps unknown string → Unknown", () => {
    expect(mapZillowStatus("SOMETHING_ELSE")).toBe("Unknown");
  });

  it("maps undefined → Unknown", () => {
    expect(mapZillowStatus(undefined)).toBe("Unknown");
  });

  it("isPending subType overrides homeStatus → Pending", () => {
    expect(mapZillowStatus("FOR_SALE", { isPending: true })).toBe("Pending");
  });

  it("contingentListingType overrides homeStatus → Accepting Backup Offers", () => {
    expect(mapZillowStatus("FOR_SALE", null, "BACKUP_OFFERS")).toBe("Accepting Backup Offers");
  });

  it("contingentListingType takes priority over isPending", () => {
    expect(mapZillowStatus("FOR_SALE", { isPending: true }, "CONTINGENT")).toBe("Accepting Backup Offers");
  });
});

// ── getStatusDate ─────────────────────────────────────────────────────────────
// Searches price history for a keyword matching the given status.

describe("getStatusDate", () => {
  it("returns null for empty history", () => {
    expect(getStatusDate([], "Sold")).toBeNull();
  });

  it("returns null for null history", () => {
    expect(getStatusDate(null, "Sold")).toBeNull();
  });

  it("finds sold date from 'Sold' keyword", () => {
    const history = makeHistory([{ date: "2026-04-01", event: "Sold" }]);
    expect(getStatusDate(history, "Sold")).toBe("2026-04-01");
  });

  it("finds pending date from 'Pending sale' keyword", () => {
    const history = makeHistory([{ date: "2026-03-15", event: "Pending sale" }]);
    expect(getStatusDate(history, "Pending")).toBe("2026-03-15");
  });

  it("finds backup offers date from 'Contingent' keyword", () => {
    const history = makeHistory([{ date: "2026-03-10", event: "Contingent" }]);
    expect(getStatusDate(history, "Accepting Backup Offers")).toBe("2026-03-10");
  });

  it("finds off-market date from 'Removed' keyword", () => {
    const history = makeHistory([{ date: "2026-03-20", event: "Removed" }]);
    expect(getStatusDate(history, "Off Market")).toBe("2026-03-20");
  });

  it("falls back to first entry date when no keyword matches", () => {
    const history = makeHistory([
      { date: "2026-04-05", event: "Listed for sale" },
      { date: "2026-03-01", event: "Listed for rent" },
    ]);
    expect(getStatusDate(history, "For Sale")).toBe("2026-04-05");
  });

  it("returns null for status with no keywords and no history entries", () => {
    expect(getStatusDate([], "Unknown")).toBeNull();
  });
});

// ── determineListing ──────────────────────────────────────────────────────────
// Core logic: maps a site + RealtyAPI result → ListingEntry | null.

describe("determineListing", () => {
  it("maps For Sale → for_sale entry", () => {
    const site   = makeSite();
    const result = makeResult({ status: "For Sale" });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry).not.toBeNull();
    expect(entry!.displayStatus).toBe("for_sale");
  });

  it("maps Unknown status → for_sale entry", () => {
    const site   = makeSite();
    const result = makeResult({ status: "Unknown" });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry!.displayStatus).toBe("for_sale");
  });

  it("maps Pending with statusDate ≥ shoot → pending entry", () => {
    const site   = makeSite({ created: "3/1/2026 10:00:00 AM" });
    const result = makeResult({ status: "Pending", statusDate: "2026-03-15" });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry!.displayStatus).toBe("pending");
    expect(entry!.statusDate).toBe("2026-03-15");
  });

  it("excludes Pending when statusDate < shoot date (pre-existing)", () => {
    const site   = makeSite({ created: "3/15/2026 10:00:00 AM" });
    const result = makeResult({ status: "Pending", statusDate: "2026-03-01" }); // before shoot
    expect(determineListing(site, result, HDPH_URL)).toBeNull();
  });

  it("maps Sold with statusDate ≥ shoot → sold entry", () => {
    const site   = makeSite({ created: "3/1/2026 10:00:00 AM" });
    const result = makeResult({ status: "Sold", statusDate: "2026-04-10" });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry!.displayStatus).toBe("sold");
  });

  it("excludes Sold when statusDate < shoot date", () => {
    const site   = makeSite({ created: "4/1/2026 10:00:00 AM" });
    const result = makeResult({ status: "Sold", statusDate: "2026-03-01" });
    expect(determineListing(site, result, HDPH_URL)).toBeNull();
  });

  it("maps Accepting Backup Offers → backup_offers entry", () => {
    const site   = makeSite({ created: "3/1/2026 10:00:00 AM" });
    const result = makeResult({ status: "Accepting Backup Offers", statusDate: "2026-03-20" });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry!.displayStatus).toBe("backup_offers");
  });

  it("maps Off Market with statusDate ≥ shoot → off_market entry", () => {
    const site   = makeSite({ created: "3/1/2026 10:00:00 AM" });
    const result = makeResult({ status: "Off Market", statusDate: "2026-04-01" });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry!.displayStatus).toBe("off_market");
  });

  it("includes listing when statusDate is null (unknown date, not excluded)", () => {
    const site   = makeSite({ created: "3/1/2026 10:00:00 AM" });
    const result = makeResult({ status: "Sold", statusDate: null });
    const entry  = determineListing(site, result, HDPH_URL);
    expect(entry!.displayStatus).toBe("sold");
  });

  it("produces stable id: sid-displayStatus", () => {
    const site   = makeSite({ sid: 9999 });
    const result = makeResult({ status: "For Sale" });
    expect(determineListing(site, result, HDPH_URL)!.id).toBe("9999-for_sale");
  });

  it("populates agent fields from site.user", () => {
    const site   = makeSite({ user: { name: "Bob Smith", email: "bob@example.com", phone: "6025550000" } });
    const result = makeResult();
    const entry  = determineListing(site, result, HDPH_URL)!;
    expect(entry.agentName).toBe("Bob Smith");
    expect(entry.agentEmail).toBe("bob@example.com");
    expect(entry.agentPhone).toBe("6025550000");
  });

  it("handles null price gracefully", () => {
    const site   = makeSite();
    const result = makeResult({ price: null });
    const entry  = determineListing(site, result, HDPH_URL)!;
    expect(entry.currentPrice).toBeNull();
  });

  it("prefers HDPH still photo over Zillow photoUrl", () => {
    const site   = makeSite({
      media: [{ type: "still", hidden: false, url: "https://hdph.example.com/photo.jpg" }],
    });
    const result = makeResult({ photoUrl: "https://zillow.example.com/photo.jpg" });
    const entry  = determineListing(site, result, HDPH_URL)!;
    expect(entry.photoUrl).toBe("https://hdph.example.com/photo.jpg");
  });

  it("falls back to Zillow photo when no HDPH still available", () => {
    const site   = makeSite({ media: [] });
    const result = makeResult({ photoUrl: "https://zillow.example.com/photo.jpg" });
    const entry  = determineListing(site, result, HDPH_URL)!;
    expect(entry.photoUrl).toBe("https://zillow.example.com/photo.jpg");
  });
});
