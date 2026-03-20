interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "blue" | "green" | "amber" | "purple";
}

const accents = {
  blue: "border-blue-400 bg-blue-50 text-blue-700",
  green: "border-green-400 bg-green-50 text-green-700",
  amber: "border-amber-400 bg-amber-50 text-amber-700",
  purple: "border-purple-400 bg-purple-50 text-purple-700",
};

export function StatCard({ label, value, sub, accent = "blue" }: StatCardProps) {
  return (
    <div className={`rounded-xl border-l-4 p-4 shadow-sm bg-white ${accents[accent]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs opacity-60">{sub}</p>}
    </div>
  );
}
