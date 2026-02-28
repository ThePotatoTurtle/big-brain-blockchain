"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { USERS } from "@/lib/users";
import type { BalanceHistoryPoint } from "@/lib/types";

function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  return cents < 0 ? `-$${dollars}` : `$${dollars}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload) return null;

  const sorted = [...payload].sort((a, b) => a.value - b.value);

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs text-muted mb-2">
        {typeof label === "number"
          ? new Date(label).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : label}
      </p>
      <div className="space-y-1">
        {sorted.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-xs">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="w-14">{entry.name}</span>
            <span
              className={`font-mono ml-auto ${
                entry.value < 0
                  ? "text-red-400"
                  : entry.value > 0
                  ? "text-green-400"
                  : "text-gray-400"
              }`}
            >
              {formatCents(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BalanceChart({
  data,
}: {
  data: BalanceHistoryPoint[];
}) {
  const [hiddenUsers, setHiddenUsers] = useState<Set<string>>(new Set());

  const toggleUser = (name: string) => {
    setHiddenUsers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center">
        <p className="text-muted">No history data yet.</p>
        <p className="text-xs text-muted mt-1">
          Balances will appear here after transactions are added.
        </p>
      </div>
    );
  }

  // Compute Y-axis domain from visible data with ~10% padding
  const visibleNames = USERS.filter((u) => !hiddenUsers.has(u.name)).map((u) => u.name);
  let yMin = 0;
  let yMax = 0;
  for (const point of data) {
    for (const name of visibleNames) {
      const val = (point as Record<string, unknown>)[name];
      if (typeof val === "number") {
        if (val < yMin) yMin = val;
        if (val > yMax) yMax = val;
      }
    }
  }
  const yRange = yMax - yMin || 1;
  const yPad = yRange * 0.1;
  const yDomain: [number, number] = [Math.floor(yMin - yPad), Math.ceil(yMax + yPad)];

  // Add timestamps for proportional X-axis scaling
  const chartData = data.map((point) => ({
    ...point,
    _ts: new Date(point.date + "T00:00:00").getTime(),
  }));

  return (
    <div className="bg-card rounded-xl p-4 md:p-6">
      {/* Custom Legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {USERS.map((u) => {
          const hidden = hiddenUsers.has(u.name);
          return (
            <button
              key={u.name}
              onClick={() => toggleUser(u.name)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity ${
                hidden ? "opacity-30" : "opacity-100"
              }`}
              style={{
                backgroundColor: u.color + "20",
                color: u.color,
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: u.color }}
              />
              {u.name}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="_ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            stroke="#94A3B8"
            fontSize={11}
            tickFormatter={(val) => {
              const d = new Date(val);
              return d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
            }}
          />
          <YAxis
            stroke="#94A3B8"
            fontSize={11}
            domain={yDomain}
            tickFormatter={(val) => formatCents(val)}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "#475569", strokeDasharray: "3 3" }}
          />
          <ReferenceLine y={0} stroke="#64748B" strokeWidth={1.5} strokeDasharray="6 3" />
          {USERS.map((u) => (
            <Line
              key={u.name}
              type="monotone"
              dataKey={u.name}
              stroke={u.color}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3.5 }}
              hide={hiddenUsers.has(u.name)}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

    </div>
  );
}
