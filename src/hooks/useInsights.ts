import { useState, useCallback, useRef } from "react";
import type { HdphSite } from "@/types/hdph";
import {
  computeBundles,
  computeServiceFrequency,
  computeMonthlyVolume,
  computeSeasonality,
  computeOutstandingAR,
} from "@/lib/data-transforms";

export function useInsights(sites: HdphSite[]) {
  const [insights, setInsights] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedForRef = useRef<number>(0); // track sites.length we last loaded for

  const load = useCallback(async (sitesSnapshot: HdphSite[]) => {
    if (sitesSnapshot.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setInsights(null);

    try {
      const payload = {
        totalSites: sitesSnapshot.length,
        outstandingAR: computeOutstandingAR(sitesSnapshot),
        bundles: computeBundles(sitesSnapshot).slice(0, 10),
        services: computeServiceFrequency(sitesSnapshot),
        monthly: computeMonthlyVolume(sitesSnapshot, 18),
        seasonality: computeSeasonality(sitesSnapshot),
      };

      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        let msg = `Server error ${res.status}`;
        try { msg = JSON.parse(body).error ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }

      setGeneratedAt(res.headers.get("X-Generated-At") ?? new Date().toISOString());

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setInsights(text);
      }

      if (text.includes("ERROR:")) {
        setError(text.split("ERROR:")[1]?.trim() ?? "Unknown error");
        setInsights(null);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    load(sites);
  }, [sites, load]);

  return { insights, generatedAt, isLoading, error, refresh };
}
