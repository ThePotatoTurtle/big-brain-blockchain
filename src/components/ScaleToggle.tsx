"use client";

import type { AxisScale } from "@/lib/chart-scale";

const OPTIONS: { value: AxisScale; label: string; title: string }[] = [
  {
    value: "linear",
    label: "Linear",
    title: "Linear — equal height means equal dollars",
  },
  {
    value: "log",
    label: "Log",
    title: "Symmetric log — spreads out the small balances (linear near zero)",
  },
];

/**
 * Y-axis scale switch, rendered at the end of a chart's legend row.
 * Intentionally component-local state in the parent: the choice is not
 * persisted, so every visit starts from that chart's own default.
 */
export default function ScaleToggle({
  value,
  onChange,
}: {
  value: AxisScale;
  onChange: (next: AxisScale) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Y-axis scale"
      className="ml-auto flex items-center gap-0.5 rounded-full bg-[var(--card-hover)] p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            title={o.title}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-accent/20 text-accent"
                : "text-muted hover:text-accent"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
