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
import { getUserById } from "@/lib/users";
import { formatMoney, type TripCurrency } from "@/lib/trips";

export interface TripHistoryPoint {
  date: string;
  [userId: string]: number | string;
}

function TooltipContent({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string | number;
  currency: TripCurrency;
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
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="w-14">{entry.name}</span>
            <span
              className={`font-mono ml-auto ${
                entry.value < 0 ? "text-red-400" : entry.value > 0 ? "text-green-400" : "text-gray-400"
              }`}
            >
              {entry.value < 0 ? "-" : ""}
              {formatMoney(Math.abs(entry.value), currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Line chart of isolated trip balances over time, one chart per currency. */
export default function TripBalanceChart({
  memberIds,
  points,
  currency,
}: {
  memberIds: number[];
  points: TripHistoryPoint[];
  currency: TripCurrency;
}) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const members = memberIds
    .map((id) => getUserById(id))
    .filter((u): u is NonNullable<typeof u> => !!u);

  if (points.length === 0) {
    return (
      <p className="text-xs text-muted px-1 py-3">
        No {currency.code} entries yet.
      </p>
    );
  }

  // Remap userId keys -> user names for recharts dataKeys
  const chartData = points.map((p) => {
    const row: Record<string, number | string> = {
      date: p.date,
      _ts: new Date(p.date + "T00:00:00").getTime(),
    };
    for (const m of members) {
      row[m.name] = (p[String(m.id)] as number) ?? 0;
    }
    return row;
  });

  let yMin = 0;
  let yMax = 0;
  for (const row of chartData) {
    for (const m of members) {
      if (hidden.has(m.id)) continue;
      const v = row[m.name];
      if (typeof v === "number") {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }
  // Round the Y domain to the currency's tick step (like the main-ledger chart).
  const step =
    currency.axisStep && currency.axisStep > 0
      ? currency.axisStep
      : Math.pow(10, currency.decimals) * 100;
  let yLo = Math.floor(yMin / step) * step;
  let yHi = Math.ceil(yMax / step) * step;
  if (yLo === yHi) {
    yLo -= step;
    yHi += step;
  }
  const yDomain: [number, number] = [yLo, yHi];
  const yTicks = (() => {
    const count = Math.round((yHi - yLo) / step) + 1;
    const t = Array.from({ length: count }, (_, i) => yLo + i * step);
    if (!t.includes(0)) t.push(0);
    return t.sort((a, b) => a - b);
  })();

  const allShown = hidden.size === 0;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setHidden(new Set())}
          disabled={allShown}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-30 disabled:cursor-default"
        >
          All
        </button>
        {members.map((u) => {
          const isHidden = hidden.has(u.id);
          return (
            <button
              key={u.id}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(u.id)) next.delete(u.id);
                  else next.add(u.id);
                  return next;
                })
              }
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity ${
                isHidden ? "opacity-30" : "opacity-100"
              }`}
              style={{ backgroundColor: u.color + "20", color: u.color }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: u.color }} />
              {u.name}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="_ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            stroke="var(--muted)"
            fontSize={11}
            tickFormatter={(val) =>
              new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
          />
          <YAxis
            stroke="var(--muted)"
            fontSize={11}
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={(val) => `${val < 0 ? "-" : ""}${formatMoney(Math.abs(Math.round(val)), currency)}`}
          />
          <Tooltip
            content={<TooltipContent currency={currency} />}
            cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
          />
          <ReferenceLine y={0} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="6 3" />
          {members.map((u) => (
            <Line
              key={u.id}
              type="monotone"
              dataKey={u.name}
              stroke={u.color}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3.5 }}
              hide={hidden.has(u.id)}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
