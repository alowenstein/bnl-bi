import useSWR from "swr";
import { useState, useCallback } from "react";
import type { ListingEntry } from "@/types/listing-status";

interface ListingChangesResponse {
  listings: ListingEntry[];
  savedAt:  string | null;
  empty:    boolean;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<ListingChangesResponse>;
  });

export function useListingChanges() {
  const [bust, setBust]               = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const swrKey = bust > 0
    ? `/api/listing-changes?bust=${bust}`
    : "/api/listing-changes";

  const { data, error, isLoading, mutate } = useSWR<ListingChangesResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/listing-changes/refresh");
      // Even on timeout/error, re-fetch GET to show whatever partial data KV has
      if (res.ok) {
        const fresh = await res.json() as ListingChangesResponse;
        mutate({ ...fresh, empty: fresh.listings.length === 0 }, { revalidate: false });
      } else {
        // Timed out — re-fetch GET which reads whatever partial data is in KV
        setBust((b) => b + 1);
        if (res.status === 504) setRefreshError("Scan timed out — showing partial results.");
      }
    } catch {
      setBust((b) => b + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [mutate]);

  return {
    listings:     data?.listings  ?? [],
    savedAt:      data?.savedAt   ?? null,
    empty:        data?.empty     ?? true,
    error,
    isLoading,
    isRefreshing,
    refreshError,
    refresh,
  };
}
