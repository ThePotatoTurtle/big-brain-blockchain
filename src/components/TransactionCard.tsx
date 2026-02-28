"use client";

import type { TransactionWithDetails } from "@/lib/types";
import { centsToDisplay, formatDate } from "@/lib/utils";
import { getUserById } from "@/lib/users";

export default function TransactionCard({
  transaction: t,
}: {
  transaction: TransactionWithDetails;
}) {
  const isSettlement = t.type === "settlement";

  // For expenses: find all payers (positive amount lines)
  const payerLines = t.lines.filter((l) => l.amount > 0);

  // For settlements
  const fromLine = isSettlement ? t.lines.find((l) => l.amount > 0) : null;
  const toLine = isSettlement ? t.lines.find((l) => l.amount < 0) : null;

  return (
    <div className="bg-card rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">{t.item}</p>
          <p className="text-xs text-muted">{formatDate(t.date)}</p>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isSettlement
              ? "bg-accent/20 text-accent"
              : "bg-positive/20 text-positive"
          }`}
        >
          {isSettlement ? "Settlement" : "Expense"}
        </span>
      </div>

      {/* Settlement display */}
      {isSettlement && fromLine && toLine && (
        <div className="flex items-center gap-2 text-sm">
          <span style={{ color: fromLine.color }} className="font-medium">
            {fromLine.userName}
          </span>
          <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <span style={{ color: toLine.color }} className="font-medium">
            {toLine.userName}
          </span>
          <span className="ml-auto font-mono font-semibold">
            {centsToDisplay(fromLine.amount)}
          </span>
        </div>
      )}

      {/* Expense display */}
      {!isSettlement && (
        <div className="space-y-1.5">
          {payerLines.length > 0 && (
            <div className="text-xs text-muted mb-1">
              {payerLines.map((l, i) => (
                <span key={l.userId}>
                  {i > 0 && " & "}
                  <span style={{ color: l.color }} className="font-medium">
                    {l.userName}
                  </span>
                </span>
              ))}{" "}
              paid{" "}
              <span className="font-mono">
                {centsToDisplay(
                  t.totalAmountCents ?? payerLines.reduce((s, l) => s + l.amount, 0)
                )}
              </span>
            </div>
          )}
          {t.lines.map((l, i) => {
            const user = getUserById(l.userId);
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: l.color }}
                />
                <span className="text-sm">{l.userName}</span>
                <span
                  className={`ml-auto font-mono text-xs font-semibold ${
                    l.amount < 0 ? "text-negative" : "text-positive"
                  }`}
                >
                  {l.amount > 0 ? "+" : ""}
                  {centsToDisplay(l.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Notes */}
      {t.notes && (
        <p className="text-xs text-muted italic">{t.notes}</p>
      )}

      {/* Attachments */}
      {t.attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {t.attachments.map((a) => (
            <a
              key={a.id}
              href={a.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 bg-background rounded-md px-2 py-1 text-xs text-accent hover:underline"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {a.fileName}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
