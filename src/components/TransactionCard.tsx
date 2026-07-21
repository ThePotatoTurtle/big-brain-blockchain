"use client";

import type { TransactionWithDetails } from "@/lib/types";
import { centsToDisplay, formatDate } from "@/lib/utils";
import { getUserById } from "@/lib/users";

/** Currency-aware formatting (JPY = whole yen; default CAD cents). */
function fmtCur(n: number, currency?: string): string {
  if (currency === "JPY") {
    return `${n < 0 ? "-" : ""}¥${Math.abs(n).toLocaleString("en-US")}`;
  }
  return centsToDisplay(n);
}

export default function TransactionCard({
  transaction: t,
  onDelete,
  onEdit,
}: {
  transaction: TransactionWithDetails;
  onDelete?: (id: number) => void;
  onEdit?: (t: TransactionWithDetails) => void;
}) {
  // Trip-close transfer entries get a fully distinct card
  if (t.transfer) return <TripTransferCard transfer={t.transfer} date={t.date} />;

  const isSettlement = t.type === "settlement";

  // Currency-aware amount formatting (JPY = whole yen; default CAD cents)
  const fmt = (n: number) => fmtCur(n, t.currency);

  // For expenses: find all payers (positive amount lines)
  const payerLines = t.lines.filter((l) => l.amount > 0);

  // Currency conversions: the per-user lines are balance adjustments, not a
  // real payment, so the "X paid Y" summary line makes no sense for them.
  const isConversion = !!t.conversionBatchId;

  // Negative expense (rebate/refund): the "X paid Y" summary would pick the
  // wrong people (payer's net is negative), so suppress it and label instead.
  const isRebate = !isSettlement && (t.totalAmountCents ?? 0) < 0;

  // Self entry (trip): no balance lines — payer(s) equal the shares exactly
  const isSelfEntry = !isSettlement && t.lines.length === 0 && !!t.shares?.length;

  // For settlements
  const fromLine = isSettlement ? t.lines.find((l) => l.amount > 0) : null;
  const toLine = isSettlement ? t.lines.find((l) => l.amount < 0) : null;

  return (
    <div className="bg-card rounded-xl p-4 space-y-3 relative overflow-hidden">
      {/* Corner triangle */}
      <div
        className={`absolute top-0 left-0 w-0 h-0 border-t-[24px] border-r-[24px] border-r-transparent ${
          isSettlement ? "border-t-corner-settlement" : "border-t-corner-expense"
        }`}
      />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">{t.item}</p>
          <p className="text-xs text-muted">{formatDate(t.date)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={() => onEdit(t)}
              className="w-5 h-5 flex items-center justify-center rounded-full text-muted hover:text-accent hover:bg-accent/20 transition-colors"
              aria-label="Edit transaction"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(t.id)}
              className="w-5 h-5 flex items-center justify-center rounded-full text-muted hover:text-negative hover:bg-negative/20 transition-colors"
              aria-label="Delete transaction"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
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
            {fmt(fromLine.amount)}
          </span>
        </div>
      )}

      {/* Self entry (no balance impact) */}
      {isSelfEntry && (
        <div className="space-y-1.5">
          {(t.shares ?? []).map((s) => {
            const user = getUserById(s.userId);
            return (
              <div key={s.userId} className="flex items-center gap-2 text-sm">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: user?.color ?? "#6B7280" }}
                />
                <span className="text-sm">{user?.name}</span>
                <span className="text-xs text-muted italic">paid for themselves</span>
                <span className="ml-auto font-mono text-xs font-semibold text-muted">
                  {fmt(s.amountCents)}
                </span>
              </div>
            );
          })}
          <p className="text-[11px] text-muted italic">
            Self entry — counted in stats, no balance change.
          </p>
        </div>
      )}

      {/* Expense display */}
      {!isSettlement && !isSelfEntry && (
        <div className="space-y-1.5">
          {isRebate && (
            <div className="text-xs text-amber-400 mb-1">
              Rebate / refund{" "}
              <span className="font-mono">{fmt(t.totalAmountCents ?? 0)}</span>
            </div>
          )}
          {!isConversion && !isRebate && payerLines.length > 0 && (
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
                {fmt(
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
                  {fmt(l.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Trip metadata chips */}
      {(t.category || t.paymentMethod || (t.currency && t.currency !== "CAD")) && (
        <div className="flex gap-1.5 flex-wrap">
          {t.category && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-background text-muted">
              {t.category}
            </span>
          )}
          {t.paymentMethod && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-background text-muted">
              {t.paymentMethod}
            </span>
          )}
          {t.currency && t.currency !== "CAD" && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-background text-muted">
              {t.currency}
            </span>
          )}
        </div>
      )}

      {/* Notes */}
      {t.notes && (
        <p className="text-xs text-muted italic whitespace-pre-line">{t.notes}</p>
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

/** Distinct card for a trip-close transfer, rich with the trip's final stats. */
function TripTransferCard({
  transfer: tr,
  date,
}: {
  transfer: NonNullable<TransactionWithDetails["transfer"]>;
  date: string;
}) {
  const owed = tr.transferred.filter((l) => l.amountCents > 0);
  const owes = tr.transferred.filter((l) => l.amountCents < 0);
  const currencies = Object.keys(tr.currencyTotals);

  return (
    <div className="bg-card rounded-xl p-4 space-y-3 relative overflow-hidden">
      {/* Corner triangle */}
      <div className="absolute top-0 left-0 w-0 h-0 border-t-[24px] border-r-[24px] border-r-transparent border-t-corner-transfer" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">Trip Transfer: {tr.tripName}</p>
          <p className="text-xs text-muted">{formatDate(date)}</p>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent/15 text-accent shrink-0">
          🔒 Trip closed
        </span>
      </div>

      <p className="text-xs text-muted">
        {formatDate(tr.startDate)} – {formatDate(tr.endDate)}
      </p>

      {/* Balances moved to main ledger */}
      <div>
        <p className="text-xs font-medium text-muted mb-1.5">Moved to main ledger</p>
        {tr.transferred.length === 0 ? (
          <p className="text-xs text-muted italic">All settled within the trip — nothing moved.</p>
        ) : (
          <div className="space-y-1">
            {[...owed, ...owes].map((l) => {
              const u = getUserById(l.userId);
              return (
                <div key={l.userId} className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: u?.color ?? "#6B7280" }} />
                  <span>{u?.name}</span>
                  <span
                    className={`ml-auto font-mono text-xs font-semibold ${
                      l.amountCents < 0 ? "text-negative" : "text-positive"
                    }`}
                  >
                    {l.amountCents > 0 ? "+" : ""}
                    {fmtCur(l.amountCents, "CAD")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Spending breakdown per currency */}
      {currencies.map((cur) => {
        const cats = tr.categoryTotals[cur] ?? {};
        const people = tr.perPerson[cur] ?? {};
        return (
          <div key={cur} className="bg-background rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Spending — {cur}</p>
              <span className="font-mono text-xs font-semibold">
                {fmtCur(tr.currencyTotals[cur], cur)}
              </span>
            </div>
            {Object.entries(cats)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, v]) => (
                <div key={cat} className="flex justify-between text-xs">
                  <span className="text-muted">{cat}</span>
                  <span className="font-mono">{fmtCur(v, cur)}</span>
                </div>
              ))}
            <div className="border-t border-border pt-1.5 space-y-1">
              {Object.entries(people)
                .sort((a, b) => b[1] - a[1])
                .map(([uid, v]) => {
                  const u = getUserById(Number(uid));
                  return (
                    <div key={uid} className="flex items-center gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: u?.color ?? "#6B7280" }} />
                      <span>{u?.name}</span>
                      <span className="ml-auto font-mono">{fmtCur(v, cur)}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
