export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
      Failed to load data: {message}
    </div>
  );
}
