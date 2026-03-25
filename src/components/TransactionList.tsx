"use client";

import { useState, useEffect, useCallback } from "react";
import type { TransactionWithDetails } from "@/lib/types";
import TransactionCard from "./TransactionCard";
import { centsToDisplay } from "@/lib/utils";

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
          <TransactionCard key={t.id} transaction={t} onDelete={handleDeleteClick} />
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
    </>
  );
}
