"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: { month: string; index: number }[];
}

export function SeasonalityChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} domain={[0, "auto"]} />
        <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "avg", fontSize: 10, fill: "#94a3b8" }} />
        <Tooltip
          formatter={(v) => [`${v}`, "Demand Index"]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="index" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.index >= 100 ? "#10b981" : "#f59e0b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
