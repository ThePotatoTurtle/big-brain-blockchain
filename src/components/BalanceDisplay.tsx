"use client";

import { useState } from "react";
import type { Balance } from "@/lib/types";
import { centsToDisplay } from "@/lib/utils";
import PersonStatementPanel from "./PersonStatementPanel";

export default function BalanceDisplay({ balances }: { balances: Balance[] }) {
  const [statementFor, setStatementFor] = useState<Balance | null>(null);
  const maxAbs = Math.max(...balances.map((b) => Math.abs(b.balanceCents)), 1);

  return (
    <div className="bg-card rounded-xl p-4 md:p-6">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
        Balances
      </h2>
      <div>
        {balances.map((b) => {
          const pct = Math.abs(b.balanceCents) / maxAbs;
          const isNeg = b.balanceCents < 0;
          const isZero = b.balanceCents === 0;

          return (
            <button
              key={b.userId}
              type="button"
              onClick={() => setStatementFor(b)}
              aria-label={`Show ${b.name}'s statement`}
              className="w-[calc(100%+1.5rem)] -mx-3 px-3 py-1.5 flex items-center gap-3 text-left rounded-lg hover:bg-background/60 transition-colors"
            >
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
            </button>
          );
        })}
      </div>
      {statementFor && (
        <PersonStatementPanel person={statementFor} onClose={() => setStatementFor(null)} />
      )}
    </div>
  );
}
