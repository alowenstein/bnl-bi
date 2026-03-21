"use client";

import { useInsights } from "@/hooks/useInsights";
import { useSites } from "@/hooks/useSites";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export function InsightsPanel() {
  const { sites } = useSites();
  const { insights, generatedAt, isLoading, error, refresh } = useInsights(sites);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">AI Business Insights</h2>
        <button
          onClick={() => refresh()}
          className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Regenerate
        </button>
      </div>

      <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-gray-500">
            <LoadingSpinner size="lg" />
            <p>Analyzing your business data with Claude…</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
            Could not generate insights: {error}
          </div>
        )}

        {insights && !isLoading && (
          <>
            <div className="prose prose-sm max-w-none text-gray-700">
              {insights.split("\n").map((line, i) => {
                if (line.startsWith("**") && line.endsWith("**")) {
                  return (
                    <h3 key={i} className="mt-4 mb-1 text-sm font-bold text-gray-900">
                      {line.replace(/\*\*/g, "")}
                    </h3>
                  );
                }
                if (line.startsWith("- ") || line.startsWith("• ")) {
                  return (
                    <p key={i} className="mb-1 ml-4 text-sm text-gray-700">
                      {line}
                    </p>
                  );
                }
                if (line.trim() === "") return <div key={i} className="mb-2" />;
                return (
                  <p key={i} className="mb-1 text-sm text-gray-700">
                    {line}
                  </p>
                );
              })}
            </div>
            {generatedAt && (
              <p className="mt-4 text-right text-xs text-gray-400">
                Generated {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
