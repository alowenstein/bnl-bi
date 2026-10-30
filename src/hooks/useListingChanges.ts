import useSWR from "swr";
import { useState, useCallback } from "react";
import type { ListingEntry } from "@/types/listing-status";

interface ListingChangesResponse {
  listings:     ListingEntry[];
  cached:       boolean;
  fetchedAt:    string;
  sitesChecked?: number;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<ListingChangesResponse>;
  });

export function useListingChanges() {
  const [bust, setBust] = useState(0);

  const swrKey = bust > 0
    ? `/api/listing-changes?bust=${bust}`
    : "/api/listing-changes";

  const { data, error, isLoading } = useSWR<ListingChangesResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const refresh = useCallback(() => setBust((b) => b + 1), []);

  return {
    listings:     data?.listings     ?? [],
    cached:       data?.cached       ?? false,
    fetchedAt:    data?.fetchedAt    ?? null,
    sitesChecked: data?.sitesChecked ?? 0,
    error,
    isLoading,
    refresh,
  };
}
