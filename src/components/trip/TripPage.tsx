"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getUserById } from "@/lib/users";
import { formatDate } from "@/lib/utils";
import { formatMoney, type TripConfig } from "@/lib/trips";
import type { TransactionWithDetails } from "@/lib/types";
import TripEntryForm from "./TripEntryForm";
import TripEditModal from "./TripEditModal";
import TripBalanceChart, { type TripHistoryPoint } from "./TripBalanceChart";
import TransactionCard from "@/components/TransactionCard";
import ReceiptForm from "@/components/ReceiptForm";
import EditReceiptModal from "@/components/EditReceiptModal";
import { isReceiptNotes } from "@/lib/receipt";

interface TripSummary {
  balances: { currency: string; users: { userId: number; balance: number }[] }[];
  history: { currency: string; points: TripHistoryPoint[] }[];
  stats: Record<string, Record<string, Record<number, number>>>;
  transferredAt: string | null;
}

/** Entries fetched per page. Also the initial count shown. */
const PAGE_SIZE = 40;

export default function TripPage({ trip }: { trip: TripConfig }) {
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [transactions, setTransactions] = useState<TransactionWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Transfer modal
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferConfirmName, setTransferConfirmName] = useState("");

  // Convert-foreign-to-CAD modal (in-trip, does not transfer to main ledger)
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertRates, setConvertRates] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState("");

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<TransactionWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit modals (receipt entries get the item-splitting UI)
  const [editTarget, setEditTarget] = useState<TransactionWithDetails | null>(null);
  const [receiptEditTarget, setReceiptEditTarget] = useState<TransactionWithDetails | null>(null);

  const locked = !!summary?.transferredAt;

  const refresh = useCallback(async () => {
    try {
      const [sumRes, txRes] = [
        await fetch(`/api/trips/${trip.slug}/summary`, { cache: "no-store" }),
        await fetch(`/api/transactions?trip=${trip.slug}&page=1&limit=${PAGE_SIZE}`, {
          cache: "no-store",
        }),
      ];
      if (sumRes.ok) setSummary(await sumRes.json());
      if (txRes.ok) {
        const data = await txRes.json();
        setTransactions(data.transactions);
        setTotal(data.total);
        setPage(1);
      }
    } catch (err) {
      console.error("Failed to load trip data:", err);
    }
  }, [trip.slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasMore = transactions.length < total;

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(
        `/api/transactions?trip=${trip.slug}&page=${nextPage}&limit=${PAGE_SIZE}`
      );
      const data = await res.json();
      setTransactions((prev) => [...prev, ...data.transactions]);
      setTotal(data.total);
      setPage(nextPage);
    } catch (err) {
      console.error("Failed to load more:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore, hasMore, trip.slug]);

  // Infinite scroll: pull the next page once the sentinel nears the viewport.
  // rootMargin starts the fetch slightly early so it feels seamless.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "300px", threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? "Failed to delete");
        return;
      }
      refresh();
    } catch {
      alert("Failed to delete entry");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Which non-CAD currencies have leftover balances (need a rate to transfer)?
  const fxNeedingRates =
    summary?.balances.filter(
      (b) => b.currency !== "CAD" && b.users.some((u) => u.balance !== 0)
    ) ?? [];

  const nameConfirmed =
    transferConfirmName.trim().toLowerCase() === trip.name.toLowerCase();

  const doTransfer = async () => {
    // Foreign balances must be converted first; trip name must be typed to confirm
    if (fxNeedingRates.length > 0 || !nameConfirmed) return;
    setTransferring(true);
    setTransferError("");
    try {
      const res = await fetch(`/api/trips/${trip.slug}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: transferConfirmName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Transfer failed");
      }
      setTransferOpen(false);
      setTransferConfirmName("");
      refresh();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setTransferring(false);
    }
  };

  const doConvert = async () => {
    setConverting(true);
    setConvertError("");
    try {
      const rates: Record<string, number> = {};
      for (const fx of fxNeedingRates) {
        const v = parseFloat(convertRates[fx.currency] ?? "");
        if (!v || v <= 0) {
          setConvertError(`Enter a valid ${fx.currency} rate`);
          setConverting(false);
          return;
        }
        rates[fx.currency] = v;
      }
      const res = await fetch(`/api/trips/${trip.slug}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Conversion failed");
      }
      setConvertOpen(false);
      setConvertRates({});
      refresh();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setConverting(false);
    }
  };

  const currencyOf = (code: string) =>
    trip.currencies.find((c) => c.code === code) ?? trip.currencies[0];

  // Foreign currency codes configured for this trip (base = trip.currencies[0], i.e. CAD)
  const foreignCodes = trip.currencies
    .filter((c) => c.code !== trip.currencies[0].code)
    .map((c) => c.code);

  /** Currency-conversion records: deletable (removes the whole batch) but not editable. */
  const isConversion = (t: TransactionWithDetails) => !!t.conversionBatchId;

  const members = trip.memberIds
    .map((id) => getUserById(id))
    .filter((u): u is NonNullable<typeof u> => !!u);

  // --- Stats helpers ---
  const statsFor = (code: string) => summary?.stats[code] ?? {};
  /**
   * Categories to show in the breakdown: the configured ones (in config order)
   * PLUS any category present in the data but no longer configured — e.g. a
   * category that was later renamed or removed. Without the second group the
   * category bars, grand total and per-person table would all silently
   * undercount, since every one of them derives from this list.
   */
  const categoriesWithSpend = (code: string) => {
    const stats = statsFor(code);
    const configured = trip.categories.filter((cat) => stats[cat]);
    const orphaned = Object.keys(stats)
      .filter((cat) => !trip.categories.includes(cat))
      .sort();
    return [...configured, ...orphaned];
  };
  const isOrphanedCategory = (cat: string) => !trip.categories.includes(cat);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* ---- Header ---- */}
      <div>
        <h1 className="text-lg font-bold">{trip.name}</h1>
        <p className="text-xs text-muted mt-0.5">
          {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
        </p>
        <div className="flex items-center gap-2 mt-2">
          {members.map((u) => (
            <span
              key={u.id}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: u.color + "20", color: u.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: u.color }} />
              {u.name}
            </span>
          ))}
        </div>
        {trip.details && trip.details.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {trip.details.map((d) => (
              <p key={d.label} className="text-xs text-muted">
                <span className="text-muted">{d.label}:</span> {d.value}
              </p>
            ))}
          </div>
        )}
        {locked && (
          <div className="mt-3 text-xs font-medium text-accent bg-accent/10 rounded-lg px-3 py-2">
            🔒 Trip closed — balances were transferred to the main ledger on{" "}
            {formatDate(summary!.transferredAt!.split("T")[0])}. Read-only.
          </div>
        )}
      </div>

      {/* ---- Balances (isolated from main) ---- */}
      <div className="bg-card rounded-xl p-4 md:p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
            Trip Balances
          </h2>
          {!locked && (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <button
                onClick={() => {
                  setTransferConfirmName("");
                  setTransferError("");
                  setTransferOpen(true);
                }}
                className="w-full sm:w-auto px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20 transition-colors whitespace-nowrap"
              >
                Transfer to main ledger
              </button>
              {foreignCodes.length > 0 && (
                <button
                  onClick={() => setConvertOpen(true)}
                  className="w-full sm:w-auto px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20 transition-colors whitespace-nowrap"
                >
                  Convert {foreignCodes.join("/")} → CAD
                </button>
              )}
            </div>
          )}
        </div>
        {!summary && <p className="text-xs text-muted">Loading...</p>}
        {summary?.balances.map((b) => {
          const cur = currencyOf(b.currency);
          const anyNonzero = b.users.some((u) => u.balance !== 0);
          return (
            <div key={b.currency}>
              <p className="text-xs text-muted mb-1.5 font-medium">{b.currency}</p>
              {!anyNonzero ? (
                <p className="text-xs text-muted italic">All settled.</p>
              ) : (
                <div className="space-y-1.5">
                  {[...b.users]
                    .sort((a, z) => a.balance - z.balance)
                    .map((u) => {
                      const user = getUserById(u.userId);
                      return (
                        <div key={u.userId} className="flex items-center gap-2 text-sm">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: user?.color }}
                          />
                          <span>{user?.name}</span>
                          <span
                            className={`ml-auto font-mono text-sm font-semibold ${
                              u.balance < 0
                                ? "text-negative"
                                : u.balance > 0
                                  ? "text-positive"
                                  : "text-muted"
                            }`}
                          >
                            {u.balance > 0 ? "+" : u.balance < 0 ? "-" : ""}
                            {formatMoney(Math.abs(u.balance), cur)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
        <p className="text-[11px] text-muted italic">
          Separate from the main ledger — settle within the trip or transfer at the end.
        </p>
      </div>

      {/* ---- Manual entry ---- */}
      {!locked && <TripEntryForm trip={trip} locked={locked} onCreated={refresh} />}

      {/* ---- Receipt scanner ---- */}
      {!locked && (
        <div>
          <ReceiptForm trip={trip} onCreated={refresh} />
        </div>
      )}

      {/* ---- Balance chart ---- */}
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
        Trip Spending
      </h2>
      <div className="bg-card rounded-xl p-4 md:p-6">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
          Balances Over Time
        </h2>
        {summary?.history.map((h) => (
          <div key={h.currency} className="mb-2">
            {summary.history.length > 1 && (
              <p className="text-xs text-muted font-medium mb-1">{h.currency}</p>
            )}
            <TripBalanceChart
              memberIds={trip.memberIds}
              points={h.points}
              currency={currencyOf(h.currency)}
            />
          </div>
        ))}
      </div>

      {/* ---- Spending breakdown ---- */}
      <div className="bg-card rounded-xl p-4 md:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
          Spending Breakdown
        </h2>
        <p className="text-[11px] text-muted italic -mt-2">
          Gross spending per person (self entries included).
        </p>
        {summary &&
          trip.currencies.map((cur) => {
            const cats = categoriesWithSpend(cur.code);
            if (cats.length === 0) return null;
            const stats = statsFor(cur.code);
            // grand totals
            const catTotals = cats.map((cat) =>
              Object.values(stats[cat]).reduce((s, v) => s + v, 0)
            );
            const grandTotal = catTotals.reduce((s, v) => s + v, 0);
            const maxCatTotal = Math.max(...catTotals, 1);
            const perUserTotal = new Map<number, number>();
            for (const cat of cats) {
              for (const [uid, v] of Object.entries(stats[cat])) {
                perUserTotal.set(Number(uid), (perUserTotal.get(Number(uid)) ?? 0) + v);
              }
            }
            return (
              <div key={cur.code} className="space-y-3">
                <p className="text-xs text-muted font-medium">{cur.code}</p>

                {/* Category bars */}
                <div className="space-y-2">
                  {cats.map((cat, i) => (
                    <div key={cat}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span>
                          {cat}
                          {isOrphanedCategory(cat) && (
                            <span className="text-amber-400 ml-1" title="No longer a configured category">
                              (legacy)
                            </span>
                          )}
                        </span>
                        <span className="font-mono">{formatMoney(catTotals[i], cur)}</span>
                      </div>
                      <div className="h-2 bg-background rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full"
                          style={{ width: `${(catTotals[i] / maxCatTotal) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs pt-1 border-t border-border">
                    <span className="font-medium">Total</span>
                    <span className="font-mono font-semibold">
                      {formatMoney(grandTotal, cur)}
                    </span>
                  </div>
                </div>

                {/* Per-person table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted">
                        <th className="text-left py-1.5 pr-2 font-medium">Category</th>
                        {members.map((u) => (
                          <th key={u.id} className="text-right py-1.5 px-2 font-medium" style={{ color: u.color }}>
                            {u.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cats.map((cat) => (
                        <tr key={cat} className="border-t border-border">
                          <td className="py-1.5 pr-2">{cat}</td>
                          {members.map((u) => {
                            const v = stats[cat][u.id] ?? 0;
                            return (
                              <td key={u.id} className="text-right py-1.5 px-2 font-mono">
                                {v > 0 ? formatMoney(v, cur) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr className="border-t border-border font-semibold">
                        <td className="py-1.5 pr-2">Total</td>
                        {members.map((u) => (
                          <td key={u.id} className="text-right py-1.5 px-2 font-mono">
                            {formatMoney(perUserTotal.get(u.id) ?? 0, cur)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        {summary &&
          trip.currencies.every((cur) => categoriesWithSpend(cur.code).length === 0) && (
            <p className="text-xs text-muted">No expenses yet.</p>
          )}
      </div>

      {/* ---- Transaction history (bottom) ---- */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
          Trip Transactions
        </h2>
        {transactions.length === 0 && (
          <div className="bg-card rounded-xl p-8 text-center">
            <p className="text-muted text-sm">No entries yet.</p>
          </div>
        )}
        {transactions.map((t) => {
          const conversion = isConversion(t);
          return (
            <TransactionCard
              key={t.id}
              transaction={t}
              onDelete={locked ? undefined : (id) => {
                const target = transactions.find((tx) => tx.id === id);
                if (target) setDeleteTarget(target);
              }}
              // Conversions can be deleted but not edited (they're a linked pair)
              onEdit={locked || conversion ? undefined : (target) => {
                if (isReceiptNotes(target.notes)) setReceiptEditTarget(target);
                else setEditTarget(target);
              }}
            />
          );
        })}
        {hasMore && (
          <div ref={sentinelRef} className="py-3 text-center">
            {loadingMore ? (
              <span className="text-sm text-muted">Loading more...</span>
            ) : (
              // Fallback for when IntersectionObserver can't fire (or is unsupported)
              <button
                onClick={loadMore}
                className="text-sm text-accent hover:underline"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---- Edit modals ---- */}
      {editTarget && (
        <TripEditModal
          transaction={editTarget}
          trip={trip}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            refresh();
          }}
        />
      )}
      {receiptEditTarget && (
        <EditReceiptModal
          transaction={receiptEditTarget}
          trip={trip}
          onClose={() => setReceiptEditTarget(null)}
          onSaved={() => {
            setReceiptEditTarget(null);
            refresh();
          }}
        />
      )}

      {/* ---- Convert foreign → CAD modal ---- */}
      {convertOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !converting && setConvertOpen(false)}
        >
          <div
            className="bg-card rounded-xl p-6 mx-4 max-w-sm w-full space-y-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">
              Convert {foreignCodes.join("/")} balances to CAD?
            </h3>
            {fxNeedingRates.length === 0 ? (
              <p className="text-sm text-muted">
                No {foreignCodes.join("/")} balances to convert right now — all foreign balances
                are already at zero.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Current{" "}
                  <span className="text-foreground font-medium">
                    {fxNeedingRates.map((fx) => fx.currency).join("/")}
                  </span>{" "}
                  balances will be set to 0 and moved into this trip&apos;s{" "}
                  <span className="text-foreground font-medium">CAD</span> balance.
                </p>
                {fxNeedingRates.map((fx) => (
                  <div key={fx.currency}>
                    <label className="block text-xs text-muted mb-1">
                      CAD{fx.currency} rate ({fx.currency} per 1 CAD)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={convertRates[fx.currency] ?? ""}
                      onChange={(e) =>
                        setConvertRates((prev) => ({ ...prev, [fx.currency]: e.target.value }))
                      }
                      placeholder={fx.currency === "JPY" ? "e.g. 113.55" : "rate"}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                ))}
              </>
            )}
            {convertError && (
              <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">
                {convertError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConvertOpen(false)}
                disabled={converting}
                className="px-4 py-2 text-sm rounded-lg bg-background text-foreground hover:bg-muted/20 transition-colors"
              >
                {fxNeedingRates.length === 0 ? "Close" : "Cancel"}
              </button>
              {fxNeedingRates.length > 0 && (
                <button
                  onClick={doConvert}
                  disabled={converting}
                  className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {converting ? "Converting..." : "Convert to CAD"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Transfer confirmation modal ---- */}
      {transferOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !transferring && setTransferOpen(false)}
        >
          <div
            className="bg-card rounded-xl p-6 mx-4 max-w-sm w-full space-y-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Transfer balances to main ledger?</h3>
            <p className="text-sm text-muted">
              Remaining <span className="text-foreground font-medium">{trip.name}</span>{" "}
              balances will be applied to the main ledger, and this trip will be{" "}
              <span className="text-foreground font-medium">permanently locked</span> (read-only).
            </p>
            {fxNeedingRates.length > 0 ? (
              <div className="text-sm text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">
                There are unconverted{" "}
                <span className="font-medium">
                  {fxNeedingRates.map((fx) => fx.currency).join("/")}
                </span>{" "}
                balances. Convert them to CAD first using the{" "}
                <span className="font-medium">Convert {foreignCodes.join("/")} → CAD</span> button.
              </div>
            ) : (
              <div>
                <label className="block text-xs text-muted mb-1">
                  Type the trip name (<span className="text-foreground font-medium">{trip.name}</span>) to
                  confirm
                </label>
                <input
                  type="text"
                  value={transferConfirmName}
                  onChange={(e) => setTransferConfirmName(e.target.value)}
                  placeholder={trip.name}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            )}
            {transferError && (
              <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">
                {transferError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setTransferOpen(false)}
                disabled={transferring}
                className="px-4 py-2 text-sm rounded-lg bg-background text-foreground hover:bg-muted/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doTransfer}
                disabled={transferring || fxNeedingRates.length > 0 || !nameConfirmed}
                className="px-4 py-2 text-sm rounded-lg bg-negative text-white font-medium hover:bg-negative/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {transferring ? "Transferring..." : "Transfer & lock"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete confirmation modal ---- */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="bg-card rounded-xl p-6 mx-4 max-w-sm w-full space-y-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">
              {isConversion(deleteTarget) ? "Delete conversion?" : "Delete entry?"}
            </h3>
            <p className="text-sm text-muted">
              {isConversion(deleteTarget) ? (
                <>
                  This undoes the currency conversion — both the foreign reversal and the CAD
                  entry are removed together, restoring the original foreign balances.
                </>
              ) : (
                <>
                  This will permanently delete{" "}
                  <span className="text-foreground font-medium">{deleteTarget.item}</span> and
                  update trip balances.
                </>
              )}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-background text-foreground hover:bg-muted/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-negative text-white font-medium hover:bg-negative/80 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
