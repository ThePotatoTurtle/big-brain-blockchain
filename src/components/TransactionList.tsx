"use client";

import { useState, useEffect, useCallback } from "react";
import type { TransactionWithDetails } from "@/lib/types";
import TransactionCard from "./TransactionCard";
import EditReceiptModal from "./EditReceiptModal";
import { centsToDisplay, dollarsToCents, splitEvenly } from "@/lib/utils";
import { USERS } from "@/lib/users";
import { isReceiptNotes } from "@/lib/receipt";
import AmountChips from "./AmountChips";

interface EditFormState {
  type: "expense" | "settlement";
  date: string;
  item: string;
  notes: string;
  // expense
  payers: { id: string; userId: number; amount: string }[];
  totalAmount: string;
  shares: { userId: number; included: boolean; amount: string }[];
  // settlement
  fromUserId: number;
  toUserId: number;
  settlementAmount: string;
}

let editPayerIdCounter = 0;

function initEditForm(t: TransactionWithDetails): EditFormState {
  if (t.type === "settlement") {
    const fromLine = t.lines.find((l) => l.amount > 0);
    const toLine = t.lines.find((l) => l.amount < 0);
    return {
      type: "settlement",
      date: t.date,
      item: t.item,
      notes: t.notes ?? "",
      payers: [{ id: `ep-${editPayerIdCounter++}`, userId: 0, amount: "" }],
      totalAmount: "",
      shares: USERS.map((u) => ({ userId: u.id, included: false, amount: "" })),
      fromUserId: fromLine?.userId ?? 0,
      toUserId: toLine?.userId ?? 0,
      settlementAmount: fromLine ? (fromLine.amount / 100).toFixed(2) : "",
    };
  }

  // Expense: reconstruct payers and shares from lines + totalAmountCents
  const payerLines = t.lines.filter((l) => l.amount > 0);
  const total = t.totalAmountCents ?? payerLines.reduce((s, l) => s + l.amount, 0);

  // Reconstruct per-person share (what they owe) from lines
  // net = paid - owed  =>  owed = paid - net
  // For each user: paid = max(0, lineAmount when positive for payer, 0 otherwise)
  // But we need to reverse-engineer payers and shares from net lines + total.
  // Payer amounts: for single payer, the total. For multi, we need the original amounts.
  // Since we don't store original payer amounts separately, derive from lines:
  // A payer's paid amount = their net line amount + their share of the expense.
  // We can't perfectly reconstruct multi-payer splits, but we can use a heuristic:
  // If there's only one positive line, that's the sole payer for the full total.
  // If multiple positive lines, each paid their line amount (no share deducted).
  // This works because computeExpenseLines stores net = paid - owed.

  // Simple approach: treat positive-line users as payers.
  // For each user, figure out what they owe using: owed = paid - net
  // But we don't know `paid` independently. We only have `net`.
  // Best approach: single payer = total, multi-payer = approximate from net + equal share.
  // Actually: for editing, let's reconstruct shares from the total and the original split.
  // The shares were: the included users whose amountCents we need.
  // From the API: shares sum = total. Lines store net = paid - owed.
  // For a single-payer expense, payer line = total - payerShare, others = -theirShare.
  // So theirShare = -lineAmount for non-payers, payerShare = total - payerLine.

  let payerEntries: { id: string; userId: number; amount: string }[];
  const shareEntries = USERS.map((u) => ({ userId: u.id, included: false, amount: "" }));

  if (payerLines.length === 1) {
    // Single payer
    const payerId = payerLines[0].userId;
    payerEntries = [{ id: `ep-${editPayerIdCounter++}`, userId: payerId, amount: (total / 100).toFixed(2) }];

    // Reconstruct shares: for payer, share = total - netLine. For others, share = -netLine.
    for (const line of t.lines) {
      const idx = shareEntries.findIndex((s) => s.userId === line.userId);
      if (idx === -1) continue;
      let owed: number;
      if (line.userId === payerId) {
        owed = total - line.amount;
      } else {
        owed = -line.amount;
      }
      if (owed > 0) {
        shareEntries[idx].included = true;
        shareEntries[idx].amount = (owed / 100).toFixed(2);
      }
    }
  } else {
    // Multi-payer: each positive line user is a payer
    // We need to figure out each payer's paid amount and each person's share.
    // net_i = paid_i - owed_i. We know net_i and sum(paid_i) = total, sum(owed_i) = total.
    // Without original data, assume equal shares among all participants as starting point.
    // Actually, for a reasonable edit UX, set each payer's amount to what they paid = net + their_share.
    // But we don't know their_share. Best effort: show net lines and let user adjust.
    // Simplest: treat all users with lines as participants sharing equally, payers = positive lines.
    const allUserIds = new Set(t.lines.map((l) => l.userId));
    const participantCount = allUserIds.size;
    const evenShare = Math.floor(total / participantCount);

    payerEntries = payerLines.map((l) => ({
      id: `ep-${editPayerIdCounter++}`,
      userId: l.userId,
      amount: ((l.amount + evenShare) / 100).toFixed(2),
    }));

    for (const line of t.lines) {
      const idx = shareEntries.findIndex((s) => s.userId === line.userId);
      if (idx === -1) continue;
      // For payers: owed = paid - net = payerAmount - line.amount
      const payerEntry = payerEntries.find((p) => p.userId === line.userId);
      let owed: number;
      if (payerEntry) {
        owed = dollarsToCents(payerEntry.amount) - line.amount;
      } else {
        owed = -line.amount;
      }
      if (owed > 0) {
        shareEntries[idx].included = true;
        shareEntries[idx].amount = (owed / 100).toFixed(2);
      }
    }
  }

  return {
    type: "expense",
    date: t.date,
    item: t.item,
    notes: t.notes ?? "",
    payers: payerEntries,
    totalAmount: (total / 100).toFixed(2),
    shares: shareEntries,
    fromUserId: 0,
    toUserId: 0,
    settlementAmount: "",
  };
}

export default function TransactionList({
  initialTransactions,
  initialTotal,
}: {
  initialTransactions: TransactionWithDetails[];
  initialTotal: number;
}) {
  const [transactions, setTransactions] =
    useState<TransactionWithDetails[]>(initialTransactions);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TransactionWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit state — receipt entries get their own modal
  const [editTarget, setEditTarget] = useState<TransactionWithDetails | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [receiptEditTarget, setReceiptEditTarget] = useState<TransactionWithDetails | null>(null);

  const hasMore = transactions.length < total;

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(`/api/transactions?page=${nextPage}&limit=20`);
      const data = await res.json();
      setTransactions((prev) => [...prev, ...data.transactions]);
      setTotal(data.total);
      setPage(nextPage);
    } catch (err) {
      console.error("Failed to load more:", err);
    } finally {
      setLoading(false);
    }
  }, [page, loading, hasMore]);

  const handleDeleteClick = useCallback((id: number) => {
    setTransactions((prev) => {
      const t = prev.find((tx) => tx.id === id);
      if (t) setDeleteTarget(t);
      return prev;
    });
  }, []);

  const handleEditClick = useCallback((t: TransactionWithDetails) => {
    if (isReceiptNotes(t.notes)) {
      setReceiptEditTarget(t);
    } else {
      setEditTarget(t);
      setEditForm(initEditForm(t));
      setEditError("");
    }
  }, []);

  const confirmDelete = useCallback(async () => {
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
      setTransactions((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete transaction");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  const submitEdit = useCallback(async () => {
    if (!editTarget || !editForm) return;
    setEditSubmitting(true);
    setEditError("");

    try {
      let reqBody: Record<string, unknown>;

      if (editForm.type === "expense") {
        const totalCents = dollarsToCents(editForm.totalAmount);
        const isMulti = editForm.payers.length > 1;
        const payersPayload = isMulti
          ? editForm.payers.map((p) => ({ userId: p.userId, amountCents: dollarsToCents(p.amount) }))
          : [{ userId: editForm.payers[0].userId, amountCents: totalCents }];
        const sharesPayload = editForm.shares
          .filter((s) => s.included)
          .map((s) => ({ userId: s.userId, amountCents: dollarsToCents(s.amount) }));

        reqBody = {
          id: editTarget.id,
          type: "expense",
          date: editForm.date,
          item: editForm.item.trim(),
          notes: editForm.notes.trim() || undefined,
          createdById: editForm.payers[0].userId,
          payers: payersPayload,
          totalAmountCents: totalCents,
          shares: sharesPayload,
        };
      } else {
        reqBody = {
          id: editTarget.id,
          type: "settlement",
          date: editForm.date,
          item: editForm.item.trim() || "Settlement",
          notes: editForm.notes.trim() || undefined,
          createdById: editForm.fromUserId,
          fromUserId: editForm.fromUserId,
          toUserId: editForm.toUserId,
          amountCents: dollarsToCents(editForm.settlementAmount),
        };
      }

      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }

      // Refresh the full list to get updated data from server
      const refreshRes = await fetch(`/api/transactions?page=1&limit=${Math.max(transactions.length, 20)}`);
      const refreshData = await refreshRes.json();
      setTransactions(refreshData.transactions);
      setTotal(refreshData.total);
      setPage(1);

      setEditTarget(null);
      setEditForm(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setEditSubmitting(false);
    }
  }, [editTarget, editForm, transactions.length]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = document.getElementById("load-more-sentinel");
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Edit form helpers
  const ef = editForm;
  const editTotalCents = ef ? dollarsToCents(ef.totalAmount) : 0;
  const editSharesSum = ef
    ? ef.shares.filter((s) => s.included).reduce((sum, s) => sum + dollarsToCents(s.amount), 0)
    : 0;
  const editSharesMatch = editTotalCents !== 0 && editSharesSum === editTotalCents;
  const editIsNegative = editTotalCents < 0;
  const editIncludedCount = ef ? ef.shares.filter((s) => s.included).length : 0;
  const editIsMultiPayer = ef ? ef.payers.length > 1 : false;
  const editPayersSumCents = ef && editIsMultiPayer
    ? ef.payers.reduce((sum, p) => sum + dollarsToCents(p.amount), 0)
    : editTotalCents;
  const editPayersMatch = editIsMultiPayer ? editTotalCents !== 0 && editPayersSumCents === editTotalCents : true;
  const editPayerUserIds = new Set(ef?.payers.map((p) => p.userId) ?? []);
  const editHasOtherThanPayer = ef ? ef.shares.some((s) => s.included && !editPayerUserIds.has(s.userId)) : false;

  const canSubmitEdit = ef
    ? ef.type === "expense"
      ? ef.item.trim() && ef.date && ef.payers.every((p) => p.userId > 0) && editPayersMatch && editTotalCents !== 0 && editIncludedCount > 0 && editHasOtherThanPayer && editSharesMatch
      : ef.item.trim() && ef.date && ef.fromUserId > 0 && ef.toUserId > 0 && dollarsToCents(ef.settlementAmount) > 0 && ef.fromUserId !== ef.toUserId
    : false;

  const handleEditSplitEvenly = () => {
    if (!ef || editTotalCents === 0 || editIncludedCount === 0) return;
    // Split the magnitude, re-apply sign (supports negative rebate entries)
    const amounts = splitEvenly(Math.abs(editTotalCents), editIncludedCount).map((v) =>
      editTotalCents < 0 ? -v : v
    );
    const primaryPayerId = ef.payers[0]?.userId ?? 0;
    const included = ef.shares.filter((s) => s.included);
    const payerIdx = included.findIndex((s) => s.userId === primaryPayerId);
    if (payerIdx > 0) {
      [amounts[0], amounts[payerIdx]] = [amounts[payerIdx], amounts[0]];
    }
    // Keyed by user rather than by a counter advanced during the map. This
    // call passes an object (not an updater), so it wasn't hit by StrictMode's
    // double-invocation like the other split handlers — keeping the shape
    // consistent so it stays correct if it's ever converted to updater form.
    const byUser = new Map(included.map((s, i) => [s.userId, amounts[i]]));
    setEditForm({
      ...ef,
      shares: ef.shares.map((s) => {
        const cents = s.included ? byUser.get(s.userId) : undefined;
        if (cents === undefined) return s;
        return { ...s, amount: (cents / 100).toFixed(2) };
      }),
    });
  };

  if (transactions.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center">
        <p className="text-muted">No transactions yet.</p>
        <p className="text-xs text-muted mt-1">
          Add an expense or settlement from the home page.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {transactions.map((t) => (
          <TransactionCard key={t.id} transaction={t} onDelete={handleDeleteClick} onEdit={handleEditClick} />
        ))}

        {hasMore && (
          <div id="load-more-sentinel" className="py-4 text-center">
            {loading ? (
              <span className="text-sm text-muted">Loading more...</span>
            ) : (
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

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="bg-card rounded-xl p-6 mx-4 max-w-sm w-full space-y-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Delete transaction?</h3>
            <p className="text-sm text-muted">
              This will permanently delete{" "}
              <span className="text-foreground font-medium">{deleteTarget.item}</span>
              {deleteTarget.totalAmountCents != null && (
                <> ({centsToDisplay(deleteTarget.totalAmountCents)})</>
              )}
              {" "}and update all balances.
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

      {/* Receipt edit modal */}
      {receiptEditTarget && (
        <EditReceiptModal
          transaction={receiptEditTarget}
          onClose={() => setReceiptEditTarget(null)}
          onSaved={(refreshed) => {
            setTransactions(refreshed);
            setTotal(refreshed.length);
            setReceiptEditTarget(null);
          }}
        />
      )}

      {/* Edit modal */}
      {editTarget && ef && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !editSubmitting && (setEditTarget(null), setEditForm(null))}
        >
          <div
            className="bg-card rounded-xl p-5 mx-4 max-w-md w-full shadow-lg max-h-[90vh] overflow-y-auto space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Edit {ef.type === "settlement" ? "settlement" : "expense"}</h3>

            {/* Date & Item */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Date</label>
                <input
                  type="date"
                  value={ef.date}
                  onChange={(e) => setEditForm({ ...ef, date: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent appearance-none"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  {ef.type === "settlement" ? "Method" : "Item"}
                </label>
                <input
                  type="text"
                  value={ef.item}
                  onChange={(e) => setEditForm({ ...ef, item: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Notes</label>
              <input
                type="text"
                value={ef.notes}
                onChange={(e) => setEditForm({ ...ef, notes: e.target.value })}
                placeholder="Optional"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>

            {ef.type === "expense" && (
              <>
                {/* Payers */}
                {!editIsMultiPayer && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted mb-1">Paid by</label>
                      <select
                        value={ef.payers[0]?.userId ?? 0}
                        onChange={(e) => setEditForm({ ...ef, payers: [{ ...ef.payers[0], userId: Number(e.target.value) }] })}
                        className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${ef.payers[0]?.userId === 0 ? "text-muted" : ""}`}
                      >
                        <option value={0} disabled>Select...</option>
                        {USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <button
                        onClick={() => setEditForm({
                          ...ef,
                          payers: [
                            { ...ef.payers[0], amount: ef.totalAmount },
                            { id: `ep-${editPayerIdCounter++}`, userId: 0, amount: "" },
                          ],
                        })}
                        className="mt-1.5 text-xs text-accent hover:text-accent/80"
                      >
                        + Add payer
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Total</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ef.totalAmount}
                          onChange={(e) => setEditForm({ ...ef, totalAmount: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg pl-7 pr-16 py-2 text-sm focus:outline-none focus:border-accent"
                        />
                        <AmountChips
                          value={ef.totalAmount}
                          onChange={(v) => setEditForm({ ...ef, totalAmount: v })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {editIsMultiPayer && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-muted mb-1">Total</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ef.totalAmount}
                          onChange={(e) => setEditForm({ ...ef, totalAmount: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg pl-7 pr-16 py-2 text-sm focus:outline-none focus:border-accent"
                        />
                        <AmountChips
                          value={ef.totalAmount}
                          onChange={(v) => setEditForm({ ...ef, totalAmount: v })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Paid by</label>
                      <div className="space-y-2">
                        {ef.payers.map((p) => {
                          const selectedByOthers = new Set(ef.payers.filter((o) => o.id !== p.id && o.userId > 0).map((o) => o.userId));
                          return (
                            <div key={p.id} className="flex items-center gap-2">
                              <select
                                value={p.userId}
                                onChange={(e) => setEditForm({
                                  ...ef,
                                  payers: ef.payers.map((pp) => pp.id === p.id ? { ...pp, userId: Number(e.target.value) } : pp),
                                })}
                                className={`flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${p.userId === 0 ? "text-muted" : ""}`}
                              >
                                <option value={0} disabled>Select...</option>
                                {USERS.map((u) => <option key={u.id} value={u.id} disabled={selectedByOthers.has(u.id)}>{u.name}</option>)}
                              </select>
                              <div className="relative flex-1">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">$</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={p.amount}
                                  onChange={(e) => {
                                    const updated = ef.payers.map((pp) => pp.id === p.id ? { ...pp, amount: e.target.value } : pp);
                                    const sum = updated.reduce((s, pp) => s + dollarsToCents(pp.amount), 0);
                                    setEditForm({ ...ef, payers: updated, totalAmount: sum > 0 ? (sum / 100).toFixed(2) : "" });
                                  }}
                                  className="w-full bg-background border border-border rounded-lg pl-5 pr-2 py-2 text-sm focus:outline-none focus:border-accent"
                                />
                              </div>
                              <button
                                onClick={() => {
                                  const updated = ef.payers.filter((pp) => pp.id !== p.id);
                                  setEditForm({ ...ef, payers: updated });
                                }}
                                className="text-muted hover:text-negative text-lg leading-none px-1"
                              >&times;</button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <button
                          onClick={() => setEditForm({ ...ef, payers: [...ef.payers, { id: `ep-${editPayerIdCounter++}`, userId: 0, amount: "" }] })}
                          className="text-xs text-accent hover:text-accent/80"
                        >+ Add payer</button>
                        {editTotalCents !== 0 && (
                          <span className={`text-xs font-mono ${editPayersMatch ? "text-positive" : "text-negative"}`}>
                            {centsToDisplay(editPayersSumCents)} / {centsToDisplay(editTotalCents)} {editPayersMatch ? "\u2713" : "\u2717"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Shares */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-muted">Split among</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditForm({ ...ef, shares: ef.shares.map((s) => ({ ...s, included: true })) })}
                        className="px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20"
                      >All</button>
                      <button
                        onClick={() => setEditForm({ ...ef, shares: ef.shares.map((s) => ({ ...s, included: false, amount: "" })) })}
                        className="px-3 py-1.5 text-xs font-medium text-muted bg-background rounded-md hover:bg-card-hover"
                      >None</button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {ef.shares.map((s) => {
                      const user = USERS.find((u) => u.id === s.userId)!;
                      return (
                        <div key={s.userId} className="flex items-center gap-2">
                          <button
                            onClick={() => setEditForm({
                              ...ef,
                              shares: ef.shares.map((ss) => ss.userId === s.userId ? { ...ss, included: !ss.included, amount: ss.included ? "" : ss.amount } : ss),
                            })}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${s.included ? "border-accent bg-accent" : "border-border bg-background"}`}
                          >
                            {s.included && (
                              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: user.color }} />
                          <span className="text-sm w-16 truncate">{user.name}</span>
                          {s.included && (
                            <div className="relative flex-1">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">$</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={s.amount}
                                onChange={(e) => setEditForm({
                                  ...ef,
                                  shares: ef.shares.map((ss) => ss.userId === s.userId ? { ...ss, amount: e.target.value } : ss),
                                })}
                                placeholder="0.00"
                                className="w-full bg-background border border-border rounded-md pl-5 pr-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <button
                      onClick={handleEditSplitEvenly}
                      disabled={editIncludedCount === 0 || editTotalCents === 0}
                      className="px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20 disabled:text-muted disabled:bg-background disabled:opacity-50"
                    >Split evenly ({editIncludedCount})</button>
                    {editIsNegative && editIncludedCount > 0 && (
                      <span className="text-[11px] text-amber-400 mr-2">Negative — rebate/refund</span>
                    )}
                    {editTotalCents !== 0 && editIncludedCount > 0 && (
                      <span className={`text-xs font-mono ${editSharesMatch ? "text-positive" : "text-negative"}`}>
                        {centsToDisplay(editSharesSum)} / {centsToDisplay(editTotalCents)} {editSharesMatch ? "\u2713" : "\u2717"}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {ef.type === "settlement" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">From</label>
                    <select
                      value={ef.fromUserId}
                      onChange={(e) => setEditForm({ ...ef, fromUserId: Number(e.target.value) })}
                      className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${ef.fromUserId === 0 ? "text-muted" : ""}`}
                    >
                      <option value={0} disabled>Select...</option>
                      {USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">To</label>
                    <select
                      value={ef.toUserId}
                      onChange={(e) => setEditForm({ ...ef, toUserId: Number(e.target.value) })}
                      className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${ef.toUserId === 0 ? "text-muted" : ""}`}
                    >
                      <option value={0} disabled>Select...</option>
                      {USERS.filter((u) => u.id !== ef.fromUserId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ef.settlementAmount}
                      onChange={(e) => setEditForm({ ...ef, settlementAmount: e.target.value })}
                      className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>
            )}

            {editError && (
              <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">{editError}</div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => { setEditTarget(null); setEditForm(null); }}
                disabled={editSubmitting}
                className="px-4 py-2 text-sm rounded-lg bg-background text-foreground hover:bg-muted/20 transition-colors"
              >Cancel</button>
              <button
                onClick={submitEdit}
                disabled={!canSubmitEdit || editSubmitting}
                className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-40"
              >{editSubmitting ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
