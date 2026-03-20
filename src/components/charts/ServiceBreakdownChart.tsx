"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";
import type { ServiceCount } from "@/types/hdph";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

interface Props {
  data: ServiceCount[];
  total: number;
}

export function ServiceBreakdownChart({ data, total }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, total]}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${Math.round((v / total) * 100)}%`}
        />
        <YAxis type="category" dataKey="service" tick={{ fontSize: 12 }} width={90} />
        <Tooltip
          formatter={(v) => [
            `${v} shoots (${Math.round((Number(v) / total) * 100)}%)`,
            "Frequency",
          ]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
