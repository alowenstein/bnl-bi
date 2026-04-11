import useSWR from "swr";
import type { ListingChange } from "@/types/listing-status";

interface ListingChangesResponse {
  changes: ListingChange[];
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<ListingChangesResponse>;
  });

const REFRESH = Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? 300_000);

export function useListingChanges() {
  const { data, error, isLoading, mutate } = useSWR<ListingChangesResponse>(
    "/api/listing-changes",
    fetcher,
    { refreshInterval: REFRESH, revalidateOnFocus: false }
  );
  return { changes: data?.changes ?? [], error, isLoading, refresh: mutate };
}
