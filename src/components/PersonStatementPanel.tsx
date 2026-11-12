"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Balance, PersonStatement } from "@/lib/types";
import { centsToDisplay, formatDate } from "@/lib/utils";

function signed(cents: number): string {
  return `${cents > 0 ? "+" : ""}${centsToDisplay(cents)}`;
}

function amountClass(cents: number): string {
  return cents < 0 ? "text-negative" : cents > 0 ? "text-positive" : "text-muted";
}

/** Modal listing every entry that moved one person's balance, newest first. */
export default function PersonStatementPanel({
  person,
  onClose,
}: {
  person: Balance;
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<PersonStatement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/statement?user=${person.userId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load statement");
        return (await res.json()) as PersonStatement;
      })
      .then((data) => {
        if (!cancelled) setStatement(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong");
      });
    return () => {
      cancelled = true;
    };
  }, [person.userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name}'s statement`}
        className="bg-card rounded-t-xl sm:rounded-xl w-full sm:max-w-md sm:mx-4 max-h-[85vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: person.color }} />
            <h3 className="text-base font-semibold">{person.name}</h3>
            <span className={`ml-auto font-mono font-semibold ${amountClass(person.balanceCents)}`}>
              {signed(person.balanceCents)}
            </span>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-muted/20 transition-colors"
              aria-label="Close"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {statement && (
            <p className="text-xs text-muted">
              {statement.entries.length} {statement.entries.length === 1 ? "entry" : "entries"}
              {" · "}
              <span className="font-mono text-positive">{signed(statement.creditsCents)}</span>
              {" / "}
              <span className="font-mono text-negative">{centsToDisplay(statement.debitsCents)}</span>
            </p>
          )}
        </div>

        {/* Entries */}
        <div className="overflow-y-auto p-2">
          {error && <p className="text-sm text-negative p-4 text-center">{error}</p>}
          {!statement && !error && <p className="text-sm text-muted p-4 text-center">Loading...</p>}
          {statement && statement.entries.length === 0 && (
            <p className="text-sm text-muted p-4 text-center">Nothing has moved this balance yet.</p>
          )}
          {statement?.entries.map((e) => (
            <Link
              key={e.id}
              href={`/transactions?id=${e.id}`}
              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-background transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{e.item}</p>
                <p className="text-xs text-muted">
                  {formatDate(e.date)}
                  {e.isTransfer ? " · trip transfer" : e.type === "settlement" ? " · settlement" : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`font-mono text-xs font-semibold ${amountClass(e.changeCents)}`}>
                  {signed(e.changeCents)}
                </p>
                <p className="font-mono text-[11px] text-muted">{centsToDisplay(e.balanceAfterCents)}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
