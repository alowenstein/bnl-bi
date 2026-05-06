import useSWR from "swr";
import { useState, useCallback } from "react";
import type { ListingChange } from "@/types/listing-status";

interface ListingChangesResponse {
  changes: ListingChange[];
  cached: boolean;
  fetchedAt: string;
  count: number;
  sitesChecked?: number;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<ListingChangesResponse>;
  });

export function useListingChanges() {
  // bust increments on manual refresh — changes the SWR key to force a fresh
  // server fetch that bypasses the server-side 1-hour cache
  const [bust, setBust] = useState(0);

  const swrKey = bust > 0
    ? `/api/listing-changes?bust=${bust}`
    : "/api/listing-changes";

  const { data, error, isLoading, mutate } = useSWR<ListingChangesResponse>(
    swrKey,
    fetcher,
    {
      // Don't auto-refresh — data is live on first load, manual refresh is enough
      refreshInterval: 0,
      revalidateOnFocus: false,
    }
  );

  const refresh = useCallback(() => {
    setBust((b) => b + 1);
  }, []);

  return {
    changes:      data?.changes ?? [],
    cached:       data?.cached ?? false,
    fetchedAt:    data?.fetchedAt ?? null,
    sitesChecked: data?.sitesChecked ?? 0,
    error,
    isLoading,
    refresh,
  };
}
