import useSWR from "swr";
import type { HdphSite } from "@/types/hdph";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<HdphSite[]>;
  });

const REFRESH = Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL ?? 300_000);

export function useSites() {
  const { data, error, isLoading, mutate } = useSWR<HdphSite[]>(
    "/api/hdph/sites",
    fetcher,
    { refreshInterval: REFRESH, revalidateOnFocus: false }
  );
  return { sites: data ?? [], error, isLoading, refresh: mutate };
}
