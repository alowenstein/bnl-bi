import { describe, it, expect } from "vitest";
import {
  mapSparkStatus,
  detectChange,
} from "@/lib/listing-status-utils";
import type { ListingSnapshot } from "@/types/listing-status";

// ── mapSparkStatus ────────────────────────────────────────────────────────────
// NOTE: mapSparkStatus maps Zillow homeStatus strings (via RealtyAPI) to our
// internal ListingStatus enum. The function name reflects ARMLS Spark API
// standards but the values match Zillow's homeStatus field.

describe("mapSparkStatus", () => {
  it("maps Active → For Sale", () => {
    expect(mapSparkStatus("Active")).toBe("For Sale");
  });

  it("maps ActiveUnderContract → Accepting Backup Offers", () => {
    expect(mapSparkStatus("ActiveUnderContract")).toBe("Accepting Backup Offers");
  });

  it("maps Pending → Pending", () => {
    expect(mapSparkStatus("Pending")).toBe("Pending");
  });

  it("maps Closed → Sold", () => {
    expect(mapSparkStatus("Closed")).toBe("Sold");
  });

  it("maps Withdrawn → Off Market", () => {
    expect(mapSparkStatus("Withdrawn")).toBe("Off Market");
  });

  it("maps Expired → Off Market", () => {
    expect(mapSparkStatus("Expired")).toBe("Off Market");
  });

  it("maps Canceled → Off Market", () => {
    expect(mapSparkStatus("Canceled")).toBe("Off Market");
  });

  it("maps unknown string → Unknown", () => {
    expect(mapSparkStatus("SomethingElse")).toBe("Unknown");
  });

  it("maps empty string → Unknown", () => {
    expect(mapSparkStatus("")).toBe("Unknown");
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
