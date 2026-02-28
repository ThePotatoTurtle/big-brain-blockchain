"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { USERS } from "@/lib/users";
import { todayString, dollarsToCents, splitEvenly, centsToDisplay } from "@/lib/utils";
import type { CreateTransactionRequest } from "@/lib/types";

type TransactionType = "expense" | "settlement";

interface ShareEntry {
  userId: number;
  included: boolean;
  amount: string; // dollar string for input
}

export default function TransactionForm() {
  const router = useRouter();
  const [type, setType] = useState<TransactionType>("expense");
  const [date, setDate] = useState(todayString());
  const [item, setItem] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Expense fields
  const [payerId, setPayerId] = useState<number>(0);
  const [totalAmount, setTotalAmount] = useState("");
  const [shares, setShares] = useState<ShareEntry[]>(
    USERS.map((u) => ({ userId: u.id, included: false, amount: "" }))
  );

  // Settlement fields
  const [fromUserId, setFromUserId] = useState<number>(0);
  const [toUserId, setToUserId] = useState<number>(0);
  const [settlementAmount, setSettlementAmount] = useState("");

  // File upload
  const [files, setFiles] = useState<File[]>([]);

  const toggleShare = (userId: number) => {
    setShares((prev) =>
      prev.map((s) =>
        s.userId === userId ? { ...s, included: !s.included, amount: s.included ? "" : s.amount } : s
      )
    );
  };

  const setShareAmount = (userId: number, amount: string) => {
    setShares((prev) =>
      prev.map((s) => (s.userId === userId ? { ...s, amount } : s))
    );
  };

  const handleSplitEvenly = () => {
    const totalCents = dollarsToCents(totalAmount);
    if (totalCents <= 0) return;

    const included = shares.filter((s) => s.included);
    if (included.length === 0) return;

    const splitAmounts = splitEvenly(totalCents, included.length);
    let idx = 0;

    setShares((prev) =>
      prev.map((s) => {
        if (!s.included) return s;
        const cents = splitAmounts[idx++];
        return { ...s, amount: (cents / 100).toFixed(2) };
      })
    );
  };

  const sharesSumCents = shares
    .filter((s) => s.included)
    .reduce((sum, s) => sum + dollarsToCents(s.amount), 0);
  const totalCents = dollarsToCents(totalAmount);
  const sharesMatch = totalCents > 0 && sharesSumCents === totalCents;
  const includedCount = shares.filter((s) => s.included).length;

  const hasOtherThanPayer = shares.some((s) => s.included && s.userId !== payerId);
  const canSubmitExpense =
    item.trim() &&
    date &&
    payerId > 0 &&
    totalCents > 0 &&
    includedCount > 0 &&
    hasOtherThanPayer &&
    sharesMatch;

  const canSubmitSettlement =
    item.trim() &&
    date &&
    fromUserId > 0 &&
    toUserId > 0 &&
    dollarsToCents(settlementAmount) > 0 &&
    fromUserId !== toUserId;

  const canSubmit = type === "expense" ? canSubmitExpense : canSubmitSettlement;

  const resetForm = () => {
    setItem("");
    setNotes("");
    setTotalAmount("");
    setShares(USERS.map((u) => ({ userId: u.id, included: false, amount: "" })));
    setSettlementAmount("");
    setFiles([]);
    setError("");
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setSuccess("");

    try {
      // Upload files first if any
      let attachmentUrls: { fileUrl: string; fileName: string }[] = [];
      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((f) => formData.append("files", f));
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload files");
        const uploadData = await uploadRes.json();
        attachmentUrls = uploadData.files;
      }

      let body: CreateTransactionRequest;

      if (type === "expense") {
        body = {
          type: "expense",
          date,
          item: item.trim(),
          notes: notes.trim() || undefined,
          createdById: payerId,
          payerId,
          totalAmountCents: totalCents,
          shares: shares
            .filter((s) => s.included)
            .map((s) => ({
              userId: s.userId,
              amountCents: dollarsToCents(s.amount),
            })),
          attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        };
      } else {
        body = {
          type: "settlement",
          date,
          item: item.trim() || "Settlement",
          notes: notes.trim() || undefined,
          createdById: fromUserId,
          fromUserId,
          toUserId,
          amountCents: dollarsToCents(settlementAmount),
          attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        };
      }

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create transaction");
      }

      setSuccess(type === "expense" ? "Expense added!" : "Settlement recorded!");
      resetForm();
      router.refresh();

      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
        New Entry
      </h2>

      {/* Type Toggle */}
      <div className="flex bg-background rounded-lg p-1 mb-4">
        <button
          onClick={() => setType("expense")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            type === "expense"
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          Expense
        </button>
        <button
          onClick={() => setType("settlement")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            type === "settlement"
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          Settlement
        </button>
      </div>

      {/* Common Fields */}
      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Item</label>
            <input
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder={type === "settlement" ? "Cash, e-Transfer..." : "Dinner, movies..."}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra details..."
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Expense Fields */}
      {type === "expense" && (
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Paid by</label>
              <select
                value={payerId}
                onChange={(e) => setPayerId(Number(e.target.value))}
                className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${payerId === 0 ? "text-muted" : ""}`}
              >
                <option value={0} disabled>Select...</option>
                {USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Total amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          {/* Split Among */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted">Split among</label>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setShares((prev) =>
                      prev.map((s) => ({ ...s, included: true }))
                    )
                  }
                  className="px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20 active:bg-accent/30 transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() =>
                    setShares((prev) =>
                      prev.map((s) => ({ ...s, included: false, amount: "" }))
                    )
                  }
                  className="px-3 py-1.5 text-xs font-medium text-muted bg-background rounded-md hover:bg-card-hover active:bg-border transition-colors"
                >
                  None
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {shares.map((s) => {
                const user = USERS.find((u) => u.id === s.userId)!;
                return (
                  <div key={s.userId} className="flex items-center gap-2">
                    <button
                      onClick={() => toggleShare(s.userId)}
                      className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        s.included
                          ? "border-accent bg-accent"
                          : "border-border bg-background"
                      }`}
                    >
                      {s.included && (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: user.color }}
                    />
                    <span className="text-sm w-16 truncate">{user.name}</span>
                    {s.included && (
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">
                          $
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={s.amount}
                          onChange={(e) =>
                            setShareAmount(s.userId, e.target.value)
                          }
                          placeholder="0.00"
                          className="w-full bg-background border border-border rounded-md pl-5 pr-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Split evenly + validation */}
            <div className="flex items-center justify-between mt-3">
              <button
                onClick={handleSplitEvenly}
                disabled={includedCount === 0 || totalCents <= 0}
                className="px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20 active:bg-accent/30 transition-colors disabled:text-muted disabled:bg-background disabled:opacity-50"
              >
                Split evenly ({includedCount})
              </button>
              {totalCents > 0 && includedCount > 0 && (
                <span
                  className={`text-xs font-mono ${
                    sharesMatch ? "text-positive" : "text-negative"
                  }`}
                >
                  {centsToDisplay(sharesSumCents)} / {centsToDisplay(totalCents)}{" "}
                  {sharesMatch ? "\u2713" : "\u2717"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settlement Fields */}
      {type === "settlement" && (
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">
                From
              </label>
              <select
                value={fromUserId}
                onChange={(e) => setFromUserId(Number(e.target.value))}
                className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${fromUserId === 0 ? "text-muted" : ""}`}
              >
                <option value={0} disabled>Select...</option>
                {USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                To
              </label>
              <select
                value={toUserId}
                onChange={(e) => setToUserId(Number(e.target.value))}
                className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${toUserId === 0 ? "text-muted" : ""}`}
              >
                <option value={0} disabled>Select...</option>
                {USERS.filter((u) => u.id !== fromUserId).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={settlementAmount}
                onChange={(e) => setSettlementAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      )}

      {/* File Upload */}
      <div className="mb-4">
        <label className="block text-xs text-muted mb-1">
          Receipt / photo (optional)
        </label>
        <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-accent/50 transition-colors">
          <div className="text-center">
            <svg className="w-5 h-5 mx-auto text-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs text-muted">Tap to add photos</span>
          </div>
          <input
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
        {files.length > 0 && (
          <div className="flex gap-2 mt-2 flex-wrap">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-1 bg-background rounded-md px-2 py-1 text-xs"
              >
                <span className="truncate max-w-[100px]">{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-muted hover:text-negative"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error / Success */}
      {error && (
        <div className="text-negative text-sm mb-3 bg-negative/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-positive text-sm mb-3 bg-positive/10 rounded-lg px-3 py-2">
          {success}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || isSubmitting}
        className="w-full py-3 bg-accent text-white font-medium rounded-lg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isSubmitting
          ? "Submitting..."
          : type === "expense"
          ? "Add Expense"
          : "Record Settlement"}
      </button>
    </div>
  );
}
