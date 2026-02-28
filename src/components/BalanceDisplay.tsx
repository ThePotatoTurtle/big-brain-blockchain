"use client";

import type { Balance } from "@/lib/types";
import { centsToDisplay } from "@/lib/utils";

export default function BalanceDisplay({ balances }: { balances: Balance[] }) {
  const maxAbs = Math.max(...balances.map((b) => Math.abs(b.balanceCents)), 1);

  return (
    <div className="bg-card rounded-xl p-4 md:p-6">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
        Balances
      </h2>
      <div className="space-y-2">
        {balances.map((b) => {
          const pct = Math.abs(b.balanceCents) / maxAbs;
          const isNeg = b.balanceCents < 0;
          const isZero = b.balanceCents === 0;

          return (
            <div key={b.userId} className="flex items-center gap-3">
              {/* Color dot */}
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: b.color }}
              />

              {/* Name */}
              <span className="w-16 text-sm font-medium truncate">
                {b.name}
              </span>

              {/* Bar */}
              <div className="flex-1 h-6 bg-background rounded-md overflow-hidden relative">
                {!isZero && (
                  <div
                    className="h-full rounded-md transition-all duration-500"
                    style={{
                      width: `${Math.max(pct * 100, 4)}%`,
                      backgroundColor: isNeg
                        ? "var(--negative)"
                        : "var(--positive)",
                      opacity: 0.7,
                    }}
                  />
                )}
              </div>

              {/* Amount */}
              <span
                className={`w-24 text-right text-sm font-mono font-semibold ${
                  isNeg
                    ? "text-negative"
                    : isZero
                    ? "text-muted"
                    : "text-positive"
                }`}
              >
                {isNeg ? "" : isZero ? "" : "+"}
                {centsToDisplay(b.balanceCents)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
