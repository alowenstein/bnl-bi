import useSWR from "swr";
import { useState, useCallback, useEffect, useRef } from "react";
import type { ListingEntry, ImageFlowCandidate } from "@/types/listing-status";

interface ListingChangesResponse {
  listings:     ListingEntry[];
  imageFlow:    ImageFlowCandidate[];
  needsRefresh: boolean;
  cached:       boolean;
  fetchedAt:    string;
  sitesChecked?: number;
  apiCalls?:     number;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<ListingChangesResponse>;
  });

export function useListingChanges() {
  const [bust, setBust]               = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef                 = useRef(false);

  const swrKey = bust > 0
    ? `/api/listing-changes?bust=${bust}`
    : "/api/listing-changes";

  const { data, error, isLoading, mutate } = useSWR<ListingChangesResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  // When GET says needsRefresh, call POST in the background to warm KV.
  // Saves progress in batches so even a timeout makes forward progress.
  useEffect(() => {
    if (!data?.needsRefresh || refreshingRef.current) return;

    refreshingRef.current = true;
    setIsRefreshing(true);

    const postUrl = bust > 0
      ? `/api/listing-changes?bust=${bust}`
      : "/api/listing-changes";

    fetch(postUrl, { method: "POST" })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<ListingChangesResponse>;
      })
      .then((fresh) => {
        // Use the POST response directly — avoids a redundant GET round-trip
        mutate(fresh, { revalidate: false });
      })
      .catch(() => {
        // POST timed out or errored — re-fetch GET to pick up any partial progress
        mutate();
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
      });
  }, [data?.needsRefresh, bust, mutate]);

  const refresh = useCallback(() => {
    setBust((b) => b + 1);
  }, []);

  return {
    listings:     data?.listings    ?? [],
    imageFlow:    data?.imageFlow   ?? [],
    cached:       data?.cached      ?? false,
    fetchedAt:    data?.fetchedAt   ?? null,
    sitesChecked: data?.sitesChecked ?? 0,
    error,
    isLoading:    isLoading || isRefreshing,
    isRefreshing,
    refresh,
    mutate,
  };
}
