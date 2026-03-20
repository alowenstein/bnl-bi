"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { MonthlyVolume } from "@/types/hdph";

interface Props {
  data: MonthlyVolume[];
}

export function VolumeChart({ data }: Props) {
  // Show short month labels (e.g. "Jan 26")
  const chartData = data.map((d) => ({
    ...d,
    shortLabel: d.label.replace(" 20", " '"),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="shortLabel"
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          formatter={(v) => [`${v} shoots`, "Volume"]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
