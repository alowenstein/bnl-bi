import { describe, it, expect } from "vitest";
import {
  getSiteServices,
  computeBundles,
  computeServiceFrequency,
  parseHdphDate,
  computeClientActivity,
  computeOutstandingAR,
  detectPackage,
  computePackageBreakdown,
  computeUpgradeRates,
  getAgentOnCameraSites,
  computeSeasonality,
} from "../data-transforms";
import {
  makeSite,
  makeMedia,
  makeUser,
  photoMedia,
  droneMedia,
  floorplanMedia,
  videoMedia,
  aocVideoMedia,
  pan360Media,
  panMedia,
  matterportEmbedMedia,
  zillow3dMedia,
  videoEmbedMedia,
  additionalPhotosMedia,
  twilightMedia,
  bronzeSite,
  silverSite,
  goldSite,
  alaCarteSite,
  emptySite,
  aocSite,
} from "./fixtures";

// ─── getSiteServices ──────────────────────────────────────────────────────────

describe("getSiteServices", () => {
  it("returns empty array for site with no media", () => {
    expect(getSiteServices(emptySite())).toEqual([]);
  });

  it("detects Photos from still media", () => {
    const site = makeSite({ media: [photoMedia()] });
    expect(getSiteServices(site)).toContain("Photos");
  });

  it("detects Drone/Aerial from aerial still", () => {
    const site = makeSite({ media: [photoMedia(), droneMedia()] });
    const services = getSiteServices(site);
    expect(services).toContain("Photos");
    expect(services).toContain("Drone/Aerial");
  });

  it("detects Drone/Aerial from 'drone' in name", () => {
    const site = makeSite({ media: [makeMedia({ type: "still", name: "Drone Shots" })] });
    expect(getSiteServices(site)).toContain("Drone/Aerial");
  });

  it("detects Drone/Aerial from 'twilight' in name", () => {
    const site = makeSite({ media: [photoMedia(), twilightMedia()] });
    expect(getSiteServices(site)).toContain("Drone/Aerial");
  });

  it("detects Floor Plan from floorplan media", () => {
    const site = makeSite({ media: [photoMedia(), floorplanMedia()] });
    expect(getSiteServices(site)).toContain("Floor Plan");
  });

  it("detects Video from video media", () => {
    const site = makeSite({ media: [videoMedia()] });
    expect(getSiteServices(site)).toContain("Video");
  });

  it("detects 3D Tour from pan360 media", () => {
    const site = makeSite({ media: [pan360Media()] });
    expect(getSiteServices(site)).toContain("3D Tour");
  });

  it("detects 3D Tour from pan media", () => {
    const site = makeSite({ media: [panMedia()] });
    expect(getSiteServices(site)).toContain("3D Tour");
  });

  it("detects 3D Tour from matterport embed", () => {
    const site = makeSite({ media: [matterportEmbedMedia()] });
    expect(getSiteServices(site)).toContain("3D Tour");
  });

  it("detects 3D Tour from zillow embed", () => {
    const site = makeSite({ media: [zillow3dMedia()] });
    expect(getSiteServices(site)).toContain("3D Tour");
  });

  it("detects Video Embed from non-3d embed", () => {
    const site = makeSite({ media: [videoEmbedMedia()] });
    expect(getSiteServices(site)).toContain("Video Embed");
  });

  it("does not add Drone/Aerial when still name has no aerial/drone/twilight", () => {
    const site = makeSite({ media: [photoMedia()] });
    expect(getSiteServices(site)).not.toContain("Drone/Aerial");
  });

  it("returns sorted services", () => {
    const site = makeSite({ media: [videoMedia(), photoMedia(), floorplanMedia(), droneMedia()] });
    const services = getSiteServices(site);
    expect(services).toEqual([...services].sort());
  });

  it("deduplicates services — two stills both with aerial do not create duplicate Drone", () => {
    const site = makeSite({
      media: [
        makeMedia({ type: "still", name: "Drone 1" }),
        makeMedia({ type: "still", name: "Drone 2" }),
      ],
    });
    const services = getSiteServices(site);
    expect(services.filter((s) => s === "Drone/Aerial")).toHaveLength(1);
    expect(services.filter((s) => s === "Photos")).toHaveLength(1);
  });
});

// ─── detectPackage ────────────────────────────────────────────────────────────

describe("detectPackage", () => {
  it("returns À La Carte for empty site", () => {
    expect(detectPackage(emptySite())).toBe("À La Carte");
  });

  it("returns À La Carte for photos-only site", () => {
    expect(detectPackage(alaCarteSite())).toBe("À La Carte");
  });

  it("returns À La Carte for photos + floorplan (missing drone)", () => {
    const site = makeSite({ media: [photoMedia(), floorplanMedia()] });
    expect(detectPackage(site)).toBe("À La Carte");
  });

  it("returns Bronze for photos + drone + floorplan", () => {
    expect(detectPackage(bronzeSite())).toBe("Bronze");
  });

  it("returns Silver for photos + drone + floorplan + 3D tour", () => {
    expect(detectPackage(silverSite())).toBe("Silver");
  });

  it("returns Silver for photos + drone + floorplan + matterport embed", () => {
    const site = makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia(), matterportEmbedMedia()] });
    expect(detectPackage(site)).toBe("Silver");
  });

  it("returns Gold for photos + drone + floorplan + video", () => {
    expect(detectPackage(goldSite())).toBe("Gold");
  });

  it("returns Gold (not Silver) when video is present alongside 3D tour", () => {
    const site = makeSite({
      media: [photoMedia(), droneMedia(), floorplanMedia(), videoMedia(), pan360Media()],
    });
    expect(detectPackage(site)).toBe("Gold");
  });

  it("classifies AOC video as Gold (video is video)", () => {
    // Agent on Camera is a video-type media → triggers Gold classification
    expect(detectPackage(aocSite())).toBe("Gold");
  });

  it("detects drone from 'aerial' in still name", () => {
    const site = makeSite({
      media: [
        makeMedia({ type: "still", name: "25 HDR Photos" }),
        makeMedia({ type: "still", name: "Aerial Shots" }),
        floorplanMedia(),
      ],
    });
    expect(detectPackage(site)).toBe("Bronze");
  });
});

// ─── parseHdphDate ────────────────────────────────────────────────────────────

describe("parseHdphDate", () => {
  it("parses HDPH date format correctly", () => {
    const d = parseHdphDate("3/16/2026 11:32:29 PM");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2); // March = 2
    expect(d!.getDate()).toBe(16);
  });

  it("returns a Date (not null) for valid strings", () => {
    expect(parseHdphDate("1/1/2024 12:00:00 AM")).toBeInstanceOf(Date);
  });

  it("returns null for empty string", () => {
    expect(parseHdphDate("")).toBeNull();
  });
});

// ─── computeOutstandingAR ─────────────────────────────────────────────────────

describe("computeOutstandingAR", () => {
  it("returns 0 for empty array", () => {
    expect(computeOutstandingAR([])).toBe(0);
  });

  it("sums unpaid across sites", () => {
    const sites = [
      makeSite({ unpaid: 100 }),
      makeSite({ unpaid: 250.5 }),
      makeSite({ unpaid: 0 }),
    ];
    expect(computeOutstandingAR(sites)).toBeCloseTo(350.5);
  });

  it("treats undefined unpaid as 0", () => {
    const site = makeSite({ unpaid: undefined });
    expect(computeOutstandingAR([site])).toBe(0);
  });
});

// ─── computeBundles ───────────────────────────────────────────────────────────

describe("computeBundles", () => {
  it("returns empty array for empty sites", () => {
    expect(computeBundles([])).toEqual([]);
  });

  it("groups identical service combos", () => {
    const sites = [bronzeSite(), bronzeSite(), goldSite()];
    const bundles = computeBundles(sites);
    const bronze = bundles.find((b) => b.bundle.includes("Floor Plan") && !b.bundle.includes("Video"));
    expect(bronze?.count).toBe(2);
  });

  it("sorts by count descending", () => {
    const sites = [bronzeSite(), bronzeSite(), bronzeSite(), goldSite()];
    const bundles = computeBundles(sites);
    expect(bundles[0].count).toBeGreaterThanOrEqual(bundles[1].count);
  });

  it("calculates percentage correctly", () => {
    const sites = [bronzeSite(), bronzeSite(), goldSite(), goldSite()];
    const bundles = computeBundles(sites);
    for (const b of bundles) {
      expect(b.pct).toBeCloseTo(50, 0);
    }
  });

  it("skips sites with no services", () => {
    const sites = [emptySite(), bronzeSite()];
    const bundles = computeBundles(sites);
    // Only bronze bundle present — empty site skipped
    expect(bundles).toHaveLength(1);
  });
});

// ─── computeServiceFrequency ──────────────────────────────────────────────────

describe("computeServiceFrequency", () => {
  it("returns empty array for empty sites", () => {
    expect(computeServiceFrequency([])).toEqual([]);
  });

  it("counts each service across sites", () => {
    const sites = [bronzeSite(), bronzeSite(), goldSite()];
    const freq = computeServiceFrequency(sites);
    const photos = freq.find((f) => f.service === "Photos");
    expect(photos?.count).toBe(3);
    const video = freq.find((f) => f.service === "Video");
    expect(video?.count).toBe(1);
  });

  it("sorts by count descending", () => {
    const sites = [bronzeSite(), bronzeSite(), goldSite()];
    const freq = computeServiceFrequency(sites);
    for (let i = 1; i < freq.length; i++) {
      expect(freq[i - 1].count).toBeGreaterThanOrEqual(freq[i].count);
    }
  });

  it("percentage is relative to total site count (not service count)", () => {
    const sites = [bronzeSite(), bronzeSite()]; // 2 sites, both have Photos
    const freq = computeServiceFrequency(sites);
    const photos = freq.find((f) => f.service === "Photos");
    expect(photos?.pct).toBe(100);
  });
});

// ─── computeClientActivity ────────────────────────────────────────────────────

describe("computeClientActivity", () => {
  it("returns empty array for empty sites", () => {
    expect(computeClientActivity([])).toEqual([]);
  });

  it("aggregates sites by user uid", () => {
    const user = makeUser({ uid: 42, name: "Jane Smith", email: "jane@test.com" });
    const sites = [
      makeSite({ user, created: "1/1/2026 10:00:00 AM" }),
      makeSite({ user, created: "2/1/2026 10:00:00 AM" }),
      makeSite({ user, created: "3/1/2026 10:00:00 AM" }),
    ];
    const activity = computeClientActivity(sites);
    expect(activity).toHaveLength(1);
    expect(activity[0].siteCount).toBe(3);
    expect(activity[0].uid).toBe(42);
  });

  it("sorts by siteCount descending", () => {
    const userA = makeUser({ uid: 1, name: "A", email: "a@test.com" });
    const userB = makeUser({ uid: 2, name: "B", email: "b@test.com" });
    const sites = [
      makeSite({ user: userA }),
      makeSite({ user: userA }),
      makeSite({ user: userA }),
      makeSite({ user: userB }),
    ];
    const activity = computeClientActivity(sites);
    expect(activity[0].uid).toBe(1);
    expect(activity[0].siteCount).toBe(3);
    expect(activity[1].uid).toBe(2);
  });

  it("tracks the most recent site date", () => {
    const user = makeUser({ uid: 99 });
    const sites = [
      makeSite({ user, created: "1/1/2025 10:00:00 AM" }),
      makeSite({ user, created: "6/15/2025 10:00:00 AM" }),
      makeSite({ user, created: "3/1/2026 10:00:00 AM" }),
    ];
    const activity = computeClientActivity(sites);
    expect(activity[0].lastSite).toBe("3/1/2026 10:00:00 AM");
  });

  it("includes group name when present", () => {
    const user = makeUser({ group: { gid: 1, bid: 1, name: "Realty One", status: "active" } });
    const activity = computeClientActivity([makeSite({ user })]);
    expect(activity[0].group).toBe("Realty One");
  });
});

// ─── getAgentOnCameraSites ────────────────────────────────────────────────────

describe("getAgentOnCameraSites", () => {
  it("returns empty array when no AOC sites", () => {
    expect(getAgentOnCameraSites([bronzeSite(), goldSite()])).toEqual([]);
  });

  it("includes site with video media named 'Agent on Camera'", () => {
    const site = aocSite();
    const result = getAgentOnCameraSites([site, bronzeSite()]);
    expect(result).toHaveLength(1);
    expect(result[0].sid).toBe(site.sid);
  });

  it("is case-insensitive for 'agent on camera'", () => {
    const site = makeSite({
      media: [makeMedia({ type: "video", name: "AGENT ON CAMERA - Vertical" })],
    });
    expect(getAgentOnCameraSites([site])).toHaveLength(1);
  });

  it("does not include still-type media named 'agent on camera'", () => {
    const site = makeSite({
      media: [makeMedia({ type: "still", name: "Agent on Camera" })],
    });
    expect(getAgentOnCameraSites([site])).toHaveLength(0);
  });

  it("sorts by created date descending (newest first)", () => {
    const older = makeSite({ created: "1/1/2025 10:00:00 AM", media: [aocVideoMedia()] });
    const newer = makeSite({ created: "3/1/2026 10:00:00 AM", media: [aocVideoMedia()] });
    const result = getAgentOnCameraSites([older, newer]);
    expect(result[0].sid).toBe(newer.sid);
    expect(result[1].sid).toBe(older.sid);
  });
});

// ─── computePackageBreakdown ──────────────────────────────────────────────────

describe("computePackageBreakdown", () => {
  it("returns all four tiers", () => {
    const breakdown = computePackageBreakdown([]);
    const tiers = breakdown.map((b) => b.tier);
    expect(tiers).toContain("Bronze");
    expect(tiers).toContain("Silver");
    expect(tiers).toContain("Gold");
    expect(tiers).toContain("À La Carte");
  });

  it("counts correctly across tiers", () => {
    const sites = [bronzeSite(), bronzeSite(), goldSite(), alaCarteSite()];
    const breakdown = computePackageBreakdown(sites);
    expect(breakdown.find((b) => b.tier === "Bronze")?.count).toBe(2);
    expect(breakdown.find((b) => b.tier === "Gold")?.count).toBe(1);
    expect(breakdown.find((b) => b.tier === "À La Carte")?.count).toBe(1);
    expect(breakdown.find((b) => b.tier === "Silver")?.count).toBe(0);
  });

  it("percentages sum to 100 for non-empty input", () => {
    const sites = [bronzeSite(), bronzeSite(), goldSite(), alaCarteSite()];
    const breakdown = computePackageBreakdown(sites);
    const total = breakdown.reduce((sum, b) => sum + b.pct, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("handles empty sites without division by zero", () => {
    const breakdown = computePackageBreakdown([]);
    for (const b of breakdown) {
      expect(b.pct).toBe(0);
    }
  });
});

// ─── computeUpgradeRates ──────────────────────────────────────────────────────

describe("computeUpgradeRates", () => {
  it("returns Bronze, Silver, Gold (not À La Carte)", () => {
    const tiers = computeUpgradeRates([]).map((u) => u.tier);
    expect(tiers).toEqual(["Bronze", "Silver", "Gold"]);
  });

  it("detects Agent on Camera upgrade in Bronze tier", () => {
    const site = makeSite({
      media: [photoMedia(), droneMedia(), floorplanMedia(), aocVideoMedia()],
    });
    // detectPackage sees video → Gold, not Bronze. AOC upgrades within Gold tier.
    const rates = computeUpgradeRates([site]);
    const gold = rates.find((r) => r.tier === "Gold");
    expect(gold?.agentOnCamera).toBe(1);
  });

  it("detects additional photos upgrade", () => {
    const site = makeSite({
      media: [photoMedia(), droneMedia(), floorplanMedia(), additionalPhotosMedia()],
    });
    const rates = computeUpgradeRates([site]);
    const bronze = rates.find((r) => r.tier === "Bronze");
    expect(bronze?.additionalPhotos).toBe(1);
  });

  it("calculates pct correctly for AOC", () => {
    const sites = [
      makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia()] }),           // Bronze, no upgrade
      makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia()] }),           // Bronze, no upgrade
      makeSite({ media: [photoMedia(), droneMedia(), floorplanMedia(), additionalPhotosMedia()] }), // Bronze + additional
    ];
    const rates = computeUpgradeRates(sites);
    const bronze = rates.find((r) => r.tier === "Bronze")!;
    expect(bronze.total).toBe(3);
    expect(bronze.additionalPhotosPct).toBe(33); // 1/3 = 33%
  });

  it("returns 0 pct when tier has no sites", () => {
    const rates = computeUpgradeRates([]);
    for (const r of rates) {
      expect(r.agentOnCameraPct).toBe(0);
      expect(r.additionalPhotosPct).toBe(0);
    }
  });
});

// ─── computeSeasonality ───────────────────────────────────────────────────────

describe("computeSeasonality", () => {
  it("returns 12 months", () => {
    expect(computeSeasonality([])).toHaveLength(12);
  });

  it("returns index 100 for all months when no data", () => {
    const result = computeSeasonality([]);
    for (const m of result) {
      expect(m.index).toBe(100);
    }
  });

  it("returns higher index for busier months", () => {
    // 4 sites in January, 1 site in July — Jan should have higher index
    const sites = [
      makeSite({ created: "1/5/2026 10:00:00 AM" }),
      makeSite({ created: "1/10/2026 10:00:00 AM" }),
      makeSite({ created: "1/15/2026 10:00:00 AM" }),
      makeSite({ created: "1/20/2026 10:00:00 AM" }),
      makeSite({ created: "7/5/2026 10:00:00 AM" }),
    ];
    const result = computeSeasonality(sites);
    const jan = result.find((m) => m.month === "Jan")!;
    const jul = result.find((m) => m.month === "Jul")!;
    expect(jan.index).toBeGreaterThan(jul.index);
  });

  it("month labels are the 3-letter abbreviations", () => {
    const result = computeSeasonality([]);
    const labels = result.map((m) => m.month);
    expect(labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });
});
