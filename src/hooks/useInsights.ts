import { useState, useCallback, useEffect, useRef } from "react";

export function useInsights() {
  const [insights, setInsights] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setInsights(null);

    try {
      const res = await fetch("/api/insights", { signal: controller.signal });

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
        setInsights(text); // update UI progressively as tokens arrive
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

  // Load on mount
  useEffect(() => { load(); }, [load]);

  return { insights, generatedAt, isLoading, error, refresh: load };
}
