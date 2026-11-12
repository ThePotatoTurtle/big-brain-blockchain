"use client";

import { useState } from "react";
import { USERS } from "@/lib/users";
import { hasActiveFilters, type TransactionFilters } from "@/lib/transaction-filters";

type DatePreset = "all" | "this-month" | "last-month" | "this-year" | "custom";

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function presetRange(preset: DatePreset): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === "this-month") return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (preset === "last-month") return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  if (preset === "this-year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return {};
}

function matchPreset(filters: TransactionFilters): DatePreset {
  if (!filters.from && !filters.to) return "all";
  for (const p of ["this-month", "last-month", "this-year"] as const) {
    const r = presetRange(p);
    if (r.from === filters.from && r.to === filters.to) return p;
  }
  return "custom";
}

const fieldClass =
  "bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent";

export default function TransactionFilterBar({
  filters,
  onChange,
  total,
  loading,
}: {
  filters: TransactionFilters;
  onChange: (next: TransactionFilters) => void;
  total: number;
  loading: boolean;
}) {
  // Choosing "Custom" keeps the current dates (which may still equal a preset,
  // or be empty), so the choice can't be derived from the filters alone
  const [customOpen, setCustomOpen] = useState(matchPreset(filters) === "custom");
  const preset: DatePreset = customOpen ? "custom" : matchPreset(filters);
  const active = hasActiveFilters(filters);

  return (
    <div className="bg-card rounded-xl p-3 space-y-2">
      <input
        type="search"
        value={filters.q ?? ""}
        onChange={(e) => onChange({ ...filters, q: e.target.value || undefined, id: undefined })}
        placeholder="Search item or notes"
        aria-label="Search transactions"
        className={`w-full ${fieldClass}`}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={filters.userId ?? 0}
          onChange={(e) => onChange({ ...filters, userId: Number(e.target.value) || undefined, id: undefined })}
          aria-label="Filter by person"
          className={`min-w-0 ${fieldClass} ${filters.userId ? "" : "text-muted"}`}
        >
          <option value={0}>Everyone</option>
          {USERS.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select
          value={filters.type ?? ""}
          onChange={(e) =>
            onChange({ ...filters, type: (e.target.value || undefined) as TransactionFilters["type"], id: undefined })
          }
          aria-label="Filter by type"
          className={`min-w-0 ${fieldClass} ${filters.type ? "" : "text-muted"}`}
        >
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="settlement">Settlements</option>
        </select>
        <select
          value={preset}
          onChange={(e) => {
            const next = e.target.value as DatePreset;
            setCustomOpen(next === "custom");
            if (next === "custom") return; // keep current dates; the inputs below take over
            const range = presetRange(next);
            onChange({ ...filters, from: range.from, to: range.to, id: undefined });
          }}
          aria-label="Filter by date"
          className={`min-w-0 ${fieldClass} ${preset === "all" ? "text-muted" : ""}`}
        >
          <option value="all">All time</option>
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="this-year">This year</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(e) => onChange({ ...filters, from: e.target.value || undefined, id: undefined })}
            aria-label="From date"
            className={`min-w-0 ${fieldClass}`}
          />
          <input
            type="date"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(e) => onChange({ ...filters, to: e.target.value || undefined, id: undefined })}
            aria-label="To date"
            className={`min-w-0 ${fieldClass}`}
          />
        </div>
      )}
      {active && (
        <div className="flex items-center justify-between text-xs text-muted px-1">
          <span>
            {loading
              ? "Searching..."
              : filters.id
                ? "Showing one entry"
                : `${total} ${total === 1 ? "result" : "results"}`}
          </span>
          <button
            onClick={() => {
              setCustomOpen(false);
              onChange({});
            }}
            className="text-accent hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
