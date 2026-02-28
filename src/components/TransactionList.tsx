"use client";

import { useState, useEffect, useCallback } from "react";
import type { TransactionWithDetails } from "@/lib/types";
import TransactionCard from "./TransactionCard";

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
    <div className="space-y-3">
      {transactions.map((t) => (
        <TransactionCard key={t.id} transaction={t} />
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
  );
}
