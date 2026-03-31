import { describe, it, expect } from "vitest";
import {
  buildZillowUrl,
  parseZillowStatus,
  parseZillowPrice,
  detectChange,
} from "@/lib/listing-status-utils";
import type { ListingSnapshot } from "@/types/listing-status";

// ── buildZillowUrl ────────────────────────────────────────────────────────────

describe("buildZillowUrl", () => {
  it("builds a standard Zillow _rb/ URL from address parts", () => {
    const url = buildZillowUrl({
      address: "9801 E Happy Valley Rd",
      city:    "Scottsdale",
      state:   "AZ",
      zip:     "85255",
    });
    expect(url).toBe(
      "https://www.zillow.com/homes/9801-e-happy-valley-rd-scottsdale-az-85255_rb/"
    );
  });

  it("handles missing optional fields", () => {
    const url = buildZillowUrl({ address: "123 Main St" });
    expect(url).toBe("https://www.zillow.com/homes/123-main-st_rb/");
  });

  it("strips punctuation from address", () => {
    const url = buildZillowUrl({
      address: "456 N. Oak Ave., Unit #2",
      city:    "Phoenix",
      state:   "AZ",
    });
    expect(url).toContain("456-n-oak-ave-unit-2");
  });

  it("collapses multiple spaces/hyphens", () => {
    const url = buildZillowUrl({ address: "100  Main   St" });
    expect(url).toBe("https://www.zillow.com/homes/100-main-st_rb/");
  });
});

// ── parseZillowStatus ─────────────────────────────────────────────────────────

describe("parseZillowStatus", () => {
  it("detects 'For Sale' from zestimate keyword", () => {
    expect(parseZillowStatus("Zestimate: $875,000 · For sale")).toBe("For Sale");
  });

  it("detects 'Pending' status", () => {
    expect(parseZillowStatus("This home is Pending. Contact the listing agent.")).toBe("Pending");
  });

  it("detects 'Under Contract' (maps to pending flow)", () => {
    expect(parseZillowStatus("Status: Under Contract")).toBe("Under Contract");
  });

  it("detects 'Accepting Backup Offers' before 'pending' keyword", () => {
    expect(parseZillowStatus("Accepting backup offers. This listing is pending.")).toBe(
      "Accepting Backup Offers"
    );
  });

  it("detects 'Sold' from 'sold on' phrase", () => {
    expect(parseZillowStatus("Sold on March 15, 2026 for $900,000")).toBe("Sold");
  });

  it("detects 'Sold' from 'this home sold'", () => {
    expect(parseZillowStatus("This home sold for $875,000.")).toBe("Sold");
  });

  it("detects 'Off Market'", () => {
    expect(parseZillowStatus("This listing is off market.")).toBe("Off Market");
  });

  it("detects 'Off Market' from 'no longer for sale'", () => {
    expect(parseZillowStatus("This home is no longer for sale.")).toBe("Off Market");
  });

  it("returns 'Unknown' when no recognizable status found", () => {
    expect(parseZillowStatus("Sorry, page not found.")).toBe("Unknown");
  });

  it("is case-insensitive", () => {
    expect(parseZillowStatus("PENDING SALE")).toBe("Pending");
  });
});

// ── parseZillowPrice ──────────────────────────────────────────────────────────

describe("parseZillowPrice", () => {
  it("parses standard comma-formatted price", () => {
    expect(parseZillowPrice("List price: $875,000")).toBe(875_000);
  });

  it("parses 7-digit price", () => {
    expect(parseZillowPrice("**$1,250,000**")).toBe(1_250_000);
  });

  it("parses shorthand K notation", () => {
    expect(parseZillowPrice("Price cut: $750k")).toBe(750_000);
  });

  it("parses shorthand M notation", () => {
    expect(parseZillowPrice("Asking $1.2M")).toBe(1_200_000);
  });

  it("returns null when no price found", () => {
    expect(parseZillowPrice("No price available")).toBeNull();
  });

  it("picks the first price in the markdown", () => {
    // Should match $500,000 before $450,000
    expect(parseZillowPrice("Price $500,000 · Zestimate $450,000")).toBe(500_000);
  });
});

// ── detectChange ─────────────────────────────────────────────────────────────

function makeSnap(
  lastStatus: ListingSnapshot["lastStatus"],
  lastPrice: number | null = null
): Pick<ListingSnapshot, "lastStatus" | "lastPrice"> {
  return { lastStatus, lastPrice };
}

describe("detectChange", () => {
  it("detects For Sale → Pending", () => {
    expect(detectChange(makeSnap("For Sale"), "Pending", null)).toBe("pending");
  });

  it("detects For Sale → Under Contract as pending", () => {
    expect(detectChange(makeSnap("For Sale"), "Under Contract", null)).toBe("pending");
  });

  it("detects For Sale → Accepting Backup Offers", () => {
    expect(detectChange(makeSnap("For Sale"), "Accepting Backup Offers", null)).toBe("backup_offers");
  });

  it("detects For Sale → Sold", () => {
    expect(detectChange(makeSnap("For Sale"), "Sold", null)).toBe("sold");
  });

  it("detects For Sale → Off Market", () => {
    expect(detectChange(makeSnap("For Sale"), "Off Market", null)).toBe("off_market");
  });

  it("detects Unknown → Pending (new listing already pending)", () => {
    expect(detectChange(makeSnap("Unknown"), "Pending", null)).toBe("pending");
  });

  it("detects Pending → For Sale as back_on_market", () => {
    expect(detectChange(makeSnap("Pending"), "For Sale", 875_000)).toBe("back_on_market");
  });

  it("detects Off Market → For Sale as back_on_market", () => {
    expect(detectChange(makeSnap("Off Market"), "For Sale", 850_000)).toBe("back_on_market");
  });

  it("detects price drop", () => {
    expect(detectChange(makeSnap("For Sale", 900_000), "For Sale", 875_000)).toBe("price_change");
  });

  it("detects price increase", () => {
    expect(detectChange(makeSnap("For Sale", 875_000), "For Sale", 900_000)).toBe("price_change");
  });

  it("returns null when status and price unchanged", () => {
    expect(detectChange(makeSnap("For Sale", 875_000), "For Sale", 875_000)).toBeNull();
  });

  it("returns null for Sold → Sold (no re-detection)", () => {
    expect(detectChange(makeSnap("Sold"), "Sold", null)).toBeNull();
  });

  it("returns null for price change when lastPrice is null (no baseline)", () => {
    expect(detectChange(makeSnap("For Sale", null), "For Sale", 875_000)).toBeNull();
  });
});
