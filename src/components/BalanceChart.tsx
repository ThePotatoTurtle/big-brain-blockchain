"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
      <p className="text-xs text-muted mb-2">{label}</p>
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
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="date"
            stroke="#94A3B8"
            fontSize={11}
            tickFormatter={(val) => {
              const d = new Date(val + "T00:00:00");
              return d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
            }}
          />
          <YAxis
            stroke="#94A3B8"
            fontSize={11}
            tickFormatter={(val) => formatCents(val)}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "#475569", strokeDasharray: "3 3" }}
          />
          {USERS.map((u) => (
            <Line
              key={u.name}
              type="monotone"
              dataKey={u.name}
              stroke={u.color}
              strokeWidth={2}
              dot={{ r: 3, fill: u.color }}
              activeDot={{ r: 5 }}
              hide={hiddenUsers.has(u.name)}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Zero line note */}
      <p className="text-xs text-muted text-center mt-2">
        Above $0 = pool owes you &middot; Below $0 = you owe the pool
      </p>
    </div>
  );
}
