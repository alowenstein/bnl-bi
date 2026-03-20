import useSWR from "swr";

interface InsightsResponse {
  insights: string;
  generatedAt: string;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<InsightsResponse>;
  });

// Insights are expensive — only refresh every 30 minutes, not on focus
export function useInsights() {
  const { data, error, isLoading, mutate } = useSWR<InsightsResponse>(
    "/api/insights",
    fetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false }
  );
  return {
    insights: data?.insights ?? null,
    generatedAt: data?.generatedAt ?? null,
    error,
    isLoading,
    refresh: mutate,
  };
}
