import type {
  HdphSite,
  ServiceType,
  BundleCount,
  ServiceCount,
  MonthlyVolume,
  ClientActivity,
  PackageTier,
  PackageStat,
  UpgradeRate,
} from "@/types/hdph";

// ─── Service detection ────────────────────────────────────────────────────────

export function getSiteServices(site: HdphSite): ServiceType[] {
  const services = new Set<ServiceType>();
  let hasPhotos = false;
  let hasDrone = false;

  for (const m of site.media) {
    const name = m.name.toLowerCase();
    if (m.type === "still") {
      hasPhotos = true;
      if (name.includes("aerial") || name.includes("drone") || name.includes("twilight")) {
        hasDrone = true;
      }
    } else if (m.type === "video") {
      services.add("Video");
    } else if (m.type === "floorplan") {
      services.add("Floor Plan");
    } else if (m.type === "pan360" || m.type === "pan") {
      services.add("3D Tour");
    }
    if (m.type === "embed" || name.includes("3d") || name.includes("matterport") || name.includes("zillow")) {
      if (name.includes("3d") || name.includes("matterport") || name.includes("zillow")) {
        services.add("3D Tour");
      } else {
        services.add("Video Embed");
      }
    }
  }

  if (hasPhotos) services.add("Photos");
  if (hasDrone) services.add("Drone/Aerial");

  return Array.from(services).sort();
}

// ─── Bundle analysis ──────────────────────────────────────────────────────────

export function computeBundles(sites: HdphSite[]): BundleCount[] {
  const counter = new Map<string, { services: ServiceType[]; count: number }>();

  for (const site of sites) {
    const services = getSiteServices(site);
    if (services.length === 0) continue;
    const key = services.join(" + ");
    const existing = counter.get(key);
    if (existing) {
      existing.count++;
    } else {
      counter.set(key, { services: services as ServiceType[], count: 1 });
    }
  }

  const total = sites.length;
  return Array.from(counter.entries())
    .map(([bundle, { services, count }]) => ({
      bundle,
      services,
      count,
      pct: Math.round((count / total) * 100 * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Service frequency ────────────────────────────────────────────────────────

export function computeServiceFrequency(sites: HdphSite[]): ServiceCount[] {
  const counter = new Map<ServiceType, number>();

  for (const site of sites) {
    for (const svc of getSiteServices(site)) {
      counter.set(svc, (counter.get(svc) ?? 0) + 1);
    }
  }

  const total = sites.length;
  return Array.from(counter.entries())
    .map(([service, count]) => ({
      service,
      count,
      pct: Math.round((count / total) * 100 * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Monthly volume ───────────────────────────────────────────────────────────

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function parseHdphDate(dateStr: string): Date | null {
  // Format: "3/16/2026 11:32:29 PM"
  try {
    return new Date(dateStr);
  } catch {
    return null;
  }
}

export function computeMonthlyVolume(
  sites: HdphSite[],
  monthsBack = 24
): MonthlyVolume[] {
  const counter = new Map<string, number>();

  for (const site of sites) {
    const dt = parseHdphDate(site.created);
    if (!dt) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }

  // Build ordered array for last N months
  const now = new Date();
  const result: MonthlyVolume[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    result.push({
      month: key,
      label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`,
      count: counter.get(key) ?? 0,
    });
  }
  return result;
}

// ─── Client activity ──────────────────────────────────────────────────────────

export function computeClientActivity(sites: HdphSite[]): ClientActivity[] {
  const map = new Map<
    number,
    { name: string; email: string; group?: string; count: number; lastCreated: string }
  >();

  for (const site of sites) {
    const u = site.user;
    if (!u) continue;
    const existing = map.get(u.uid);
    if (existing) {
      existing.count++;
      // Keep latest created date
      if (site.created > existing.lastCreated) {
        existing.lastCreated = site.created;
      }
    } else {
      map.set(u.uid, {
        name: u.name,
        email: u.email,
        group: u.group?.name,
        count: 1,
        lastCreated: site.created,
      });
    }
  }

  return Array.from(map.entries())
    .map(([uid, { name, email, group, count, lastCreated }]) => ({
      uid,
      name,
      email,
      group,
      siteCount: count,
      lastSite: lastCreated,
    }))
    .sort((a, b) => b.siteCount - a.siteCount);
}

// ─── Outstanding AR ───────────────────────────────────────────────────────────

export function computeOutstandingAR(sites: HdphSite[]): number {
  return sites.reduce((sum, s) => sum + (s.unpaid ?? 0), 0);
}

// ─── Package tier detection ───────────────────────────────────────────────────
//
// Bronze = Photos + Drone + Floor Plan (no video, no 3D tour)
// Silver = Photos + Drone + Floor Plan + 3D Tour (no video)
// Gold   = Photos + Drone + Floor Plan + Video (video is included in Gold base)
// NOTE: A Silver site that added the video add-on will be classified as Gold
// because the API doesn't store which package was ordered.

export function detectPackage(site: HdphSite): PackageTier {
  const media = site.media ?? [];
  let hasPhotos = false;
  let hasDrone = false;
  let hasFloorPlan = false;
  let hasVideo = false;
  let has3dTour = false;

  for (const m of media) {
    const name = (m.name ?? "").toLowerCase();
    if (m.type === "still") {
      hasPhotos = true;
      if (name.includes("aerial") || name.includes("drone")) hasDrone = true;
    } else if (m.type === "video") {
      hasVideo = true;
    } else if (m.type === "floorplan") {
      hasFloorPlan = true;
    } else if (m.type === "pan360" || m.type === "pan") {
      has3dTour = true;
    } else if (
      m.type === "embed" &&
      (name.includes("3d") || name.includes("matterport") || name.includes("zillow"))
    ) {
      has3dTour = true;
    }
  }

  if (hasPhotos && hasDrone && hasFloorPlan && hasVideo) return "Gold";
  if (hasPhotos && hasDrone && hasFloorPlan && has3dTour) return "Silver";
  if (hasPhotos && hasDrone && hasFloorPlan) return "Bronze";
  return "À La Carte";
}

export function computePackageBreakdown(sites: HdphSite[]): PackageStat[] {
  const counts: Record<PackageTier, number> = {
    Bronze: 0,
    Silver: 0,
    Gold: 0,
    "À La Carte": 0,
  };
  for (const site of sites) {
    counts[detectPackage(site)]++;
  }
  const total = sites.length || 1;
  return (["Bronze", "Silver", "Gold", "À La Carte"] as PackageTier[]).map((tier) => ({
    tier,
    count: counts[tier],
    pct: Math.round((counts[tier] / total) * 100 * 10) / 10,
  }));
}

export function computeUpgradeRates(sites: HdphSite[]): UpgradeRate[] {
  const stats: Record<PackageTier, { total: number; agentOnCamera: number; additionalPhotos: number }> = {
    Bronze: { total: 0, agentOnCamera: 0, additionalPhotos: 0 },
    Silver: { total: 0, agentOnCamera: 0, additionalPhotos: 0 },
    Gold: { total: 0, agentOnCamera: 0, additionalPhotos: 0 },
    "À La Carte": { total: 0, agentOnCamera: 0, additionalPhotos: 0 },
  };

  for (const site of sites) {
    const tier = detectPackage(site);
    const s = stats[tier];
    s.total++;
    const names = (site.media ?? []).map((m) => (m.name ?? "").toLowerCase());
    if (names.some((n) => n.includes("agent on camera") || n.includes("agent-on-camera"))) {
      s.agentOnCamera++;
    }
    if (names.some((n) => n.includes("additional"))) {
      s.additionalPhotos++;
    }
  }

  return (["Bronze", "Silver", "Gold"] as PackageTier[]).map((tier) => {
    const s = stats[tier];
    return {
      tier,
      total: s.total,
      agentOnCamera: s.agentOnCamera,
      additionalPhotos: s.additionalPhotos,
      agentOnCameraPct: s.total > 0 ? Math.round((s.agentOnCamera / s.total) * 100) : 0,
      additionalPhotosPct: s.total > 0 ? Math.round((s.additionalPhotos / s.total) * 100) : 0,
    };
  });
}

// ─── Agent on Camera orders ───────────────────────────────────────────────────

export function getAgentOnCameraSites(sites: HdphSite[]): HdphSite[] {
  return sites
    .filter((site) =>
      site.media.some(
        (m) => m.type === "video" && m.name.toLowerCase().includes("agent on camera")
      )
    )
    .sort((a, b) => {
      const da = parseHdphDate(a.created);
      const db = parseHdphDate(b.created);
      return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
    });
}

// ─── Seasonality index (relative to yearly average) ──────────────────────────

export function computeSeasonality(sites: HdphSite[]): { month: string; index: number }[] {
  const monthlyCounts = new Array(12).fill(0);
  const yearCounts = new Map<number, number>();

  for (const site of sites) {
    const dt = parseHdphDate(site.created);
    if (!dt) continue;
    monthlyCounts[dt.getMonth()]++;
    yearCounts.set(dt.getFullYear(), (yearCounts.get(dt.getFullYear()) ?? 0) + 1);
  }

  const numYears = yearCounts.size || 1;
  const monthlyAvg = monthlyCounts.map((c) => c / numYears);
  const overallAvg = monthlyAvg.reduce((a, b) => a + b, 0) / 12;

  return MONTH_LABELS.map((label, i) => ({
    month: label,
    index: overallAvg > 0 ? Math.round((monthlyAvg[i] / overallAvg) * 100) : 100,
  }));
}
