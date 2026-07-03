"use client";

import { useState } from "react";
import { USERS } from "@/lib/users";
import { toMinorUnits, formatMoney, type TripConfig, type TripCurrency } from "@/lib/trips";
import type { TransactionWithDetails } from "@/lib/types";

let payerIdCounter = 0;

interface PayerEntry {
  id: string;
  userId: number;
  amount: string;
}

interface ShareEntry {
  userId: number;
  included: boolean;
  amount: string;
}

/** Edit-in-place for regular (non-receipt) trip expenses and settlements. */
export default function TripEditModal({
  transaction: t,
  trip,
  onClose,
  onSaved,
}: {
  transaction: TransactionWithDetails;
  trip: TripConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const members = USERS.filter((u) => trip.memberIds.includes(u.id));
  const isSettlement = t.type === "settlement";
  const currency: TripCurrency =
    trip.currencies.find((c) => c.code === t.currency) ?? trip.currencies[0];
  const toMinor = (v: string) => toMinorUnits(v, currency.decimals);
  const fmt = (n: number) => formatMoney(n, currency);
  const minorToInput = (minor: number) =>
    (minor / Math.pow(10, currency.decimals)).toFixed(currency.decimals);

  // --- Initial state reconstruction (trip entries store exact payers/shares) ---
  const total =
    t.totalAmountCents ?? t.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);

  const initPayers: PayerEntry[] = (() => {
    if (isSettlement) return [{ id: `te-${payerIdCounter++}`, userId: 0, amount: "" }];
    const stored = t.payers ?? [];
    if (stored.length > 1) {
      return stored.map((p) => ({
        id: `te-${payerIdCounter++}`,
        userId: p.userId,
        amount: minorToInput(p.amountCents),
      }));
    }
    const payerId = stored[0]?.userId ?? t.lines.find((l) => l.amount > 0)?.userId ?? 0;
    return [{ id: `te-${payerIdCounter++}`, userId: payerId, amount: minorToInput(total) }];
  })();

  const initShares: ShareEntry[] = members.map((u) => {
    const s = (t.shares ?? []).find((sh) => sh.userId === u.id);
    return {
      userId: u.id,
      included: !!s,
      amount: s ? minorToInput(s.amountCents) : "",
    };
  });

  const fromLine = isSettlement ? t.lines.find((l) => l.amount > 0) : null;
  const toLine = isSettlement ? t.lines.find((l) => l.amount < 0) : null;

  const [date, setDate] = useState(t.date);
  const [item, setItem] = useState(t.item);
  const [notes, setNotes] = useState(t.notes ?? "");
  const [payers, setPayers] = useState<PayerEntry[]>(initPayers);
  const [totalAmount, setTotalAmount] = useState(isSettlement ? "" : minorToInput(total));
  const [shares, setShares] = useState<ShareEntry[]>(initShares);
  const [fromUserId, setFromUserId] = useState(fromLine?.userId ?? 0);
  const [toUserId, setToUserId] = useState(toLine?.userId ?? 0);
  const [settlementAmount, setSettlementAmount] = useState(
    fromLine ? minorToInput(fromLine.amount) : ""
  );
  const [category, setCategory] = useState(t.category ?? "");
  const initMethodKnown = !t.paymentMethod || trip.paymentMethods.includes(t.paymentMethod);
  const [method, setMethod] = useState(
    t.paymentMethod ? (initMethodKnown ? t.paymentMethod : "Others") : ""
  );
  const [methodOther, setMethodOther] = useState(initMethodKnown ? "" : t.paymentMethod ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isMultiPayer = payers.length > 1;
  const primaryPayerId = payers[0]?.userId ?? 0;
  const totalMinor = toMinor(totalAmount);
  const sharesSum = shares.filter((s) => s.included).reduce((sum, s) => sum + toMinor(s.amount), 0);
  const sharesMatch = totalMinor > 0 && sharesSum === totalMinor;
  const includedCount = shares.filter((s) => s.included).length;
  const payersSum = isMultiPayer
    ? payers.reduce((sum, p) => sum + toMinor(p.amount), 0)
    : totalMinor;
  const payersMatch = isMultiPayer ? totalMinor > 0 && payersSum === totalMinor : true;

  // Self entries allowed on trips — no hasOtherThanPayer requirement
  const canSubmit = isSettlement
    ? date && fromUserId > 0 && toUserId > 0 && toMinor(settlementAmount) > 0 && fromUserId !== toUserId
    : item.trim() && date && payers.every((p) => p.userId > 0) && payersMatch &&
      totalMinor > 0 && includedCount > 0 && sharesMatch && category !== "";

  const handleSplitEvenly = () => {
    if (totalMinor <= 0 || includedCount === 0) return;
    const included = shares.filter((s) => s.included);
    const base = Math.floor(totalMinor / included.length);
    const remainder = totalMinor - base * included.length;
    const amounts = included.map((_, i) => base + (i < remainder ? 1 : 0));
    const payerIdx = included.findIndex((s) => s.userId === primaryPayerId);
    if (payerIdx > 0) {
      [amounts[0], amounts[payerIdx]] = [amounts[payerIdx], amounts[0]];
    }
    let idx = 0;
    setShares((prev) =>
      prev.map((s) => (s.included ? { ...s, amount: minorToInput(amounts[idx++]) } : s))
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const tripFields = {
        currency: currency.code,
        category: category || undefined,
        paymentMethod: (method === "Others" ? methodOther.trim() : method) || undefined,
      };
      let body: Record<string, unknown>;
      if (isSettlement) {
        body = {
          id: t.id,
          type: "settlement",
          date,
          item: item.trim() || "Settlement",
          notes: notes.trim() || undefined,
          createdById: fromUserId,
          fromUserId,
          toUserId,
          amountCents: toMinor(settlementAmount),
          ...tripFields,
        };
      } else {
        const payersPayload = isMultiPayer
          ? payers.map((p) => ({ userId: p.userId, amountCents: toMinor(p.amount) }))
          : [{ userId: primaryPayerId, amountCents: totalMinor }];
        body = {
          id: t.id,
          type: "expense",
          date,
          item: item.trim(),
          notes: notes.trim() || undefined,
          createdById: payers[0].userId,
          payers: payersPayload,
          totalAmountCents: totalMinor,
          shares: shares
            .filter((s) => s.included)
            .map((s) => ({ userId: s.userId, amountCents: toMinor(s.amount) })),
          ...tripFields,
        };
      }

      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-card rounded-xl p-5 mx-4 max-w-md w-full shadow-lg max-h-[90vh] overflow-y-auto space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">
          Edit {isSettlement ? "settlement" : "expense"}
          <span className="text-muted font-normal"> — {currency.code}</span>
        </h3>

        {/* Date & Item */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className={`${inputCls} appearance-none`} />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">
              {isSettlement ? "Method" : "Item"}
            </label>
            <input type="text" value={item} onChange={(e) => setItem(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Category + method — expenses only */}
        {!isSettlement && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`${inputCls} ${category === "" ? "text-muted" : ""}`}
              >
                <option value="" disabled>Select...</option>
                {trip.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Payment method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={`${inputCls} ${method === "" ? "text-muted" : ""}`}
              >
                <option value="" disabled>Select...</option>
                {trip.paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {method === "Others" && (
                <input
                  type="text"
                  value={methodOther}
                  onChange={(e) => setMethodOther(e.target.value)}
                  placeholder="Fill in method..."
                  className={`${inputCls} mt-1.5`}
                />
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-muted mb-1">Notes</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional" className={inputCls} />
        </div>

        {!isSettlement && (
          <>
            {/* Payers */}
            {!isMultiPayer ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Paid by</label>
                  <select
                    value={primaryPayerId}
                    onChange={(e) => setPayers([{ ...payers[0], userId: Number(e.target.value) }])}
                    className={`${inputCls} ${primaryPayerId === 0 ? "text-muted" : ""}`}
                  >
                    <option value={0} disabled>Select...</option>
                    {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <button
                    onClick={() =>
                      setPayers([
                        { ...payers[0], amount: totalAmount },
                        { id: `te-${payerIdCounter++}`, userId: 0, amount: "" },
                      ])
                    }
                    className="mt-1.5 text-xs text-accent hover:text-accent/80"
                  >
                    + Add payer
                  </button>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Total</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                      {currency.symbol}
                    </span>
                    <input type="text" inputMode="decimal" value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)} className={`${inputCls} pl-7`} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-muted mb-1">Total</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                      {currency.symbol}
                    </span>
                    <input type="text" inputMode="decimal" value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)} className={`${inputCls} pl-7`} />
                  </div>
                </div>
                {payers.map((p) => {
                  const others = new Set(
                    payers.filter((o) => o.id !== p.id && o.userId > 0).map((o) => o.userId)
                  );
                  return (
                    <div key={p.id} className="flex gap-2">
                      <select
                        value={p.userId}
                        onChange={(e) =>
                          setPayers(payers.map((pp) => pp.id === p.id ? { ...pp, userId: Number(e.target.value) } : pp))
                        }
                        className={`flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${p.userId === 0 ? "text-muted" : ""}`}
                      >
                        <option value={0} disabled>Select...</option>
                        {members.map((u) => (
                          <option key={u.id} value={u.id} disabled={others.has(u.id)}>{u.name}</option>
                        ))}
                      </select>
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">
                          {currency.symbol}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={p.amount}
                          onChange={(e) => {
                            const updated = payers.map((pp) => pp.id === p.id ? { ...pp, amount: e.target.value } : pp);
                            setPayers(updated);
                            const sum = updated.reduce((s, pp) => s + toMinor(pp.amount), 0);
                            setTotalAmount(sum > 0 ? minorToInput(sum) : "");
                          }}
                          className="w-full bg-background border border-border rounded-lg pl-5 pr-2 py-2 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                      <button
                        onClick={() => setPayers(payers.filter((pp) => pp.id !== p.id))}
                        className="text-muted hover:text-negative text-lg leading-none px-1"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                <div className="flex justify-between">
                  <button
                    onClick={() => setPayers([...payers, { id: `te-${payerIdCounter++}`, userId: 0, amount: "" }])}
                    className="text-xs text-accent hover:text-accent/80"
                  >
                    + Add payer
                  </button>
                  {totalMinor > 0 && (
                    <span className={`text-xs font-mono ${payersMatch ? "text-positive" : "text-negative"}`}>
                      {fmt(payersSum)} / {fmt(totalMinor)} {payersMatch ? "✓" : "✗"}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Shares */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted">Split among</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShares(shares.map((s) => ({ ...s, included: true })))}
                    className="px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setShares(shares.map((s) => ({ ...s, included: false, amount: "" })))}
                    className="px-3 py-1.5 text-xs font-medium text-muted bg-background rounded-md hover:bg-card-hover"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {shares.map((s) => {
                  const user = members.find((u) => u.id === s.userId)!;
                  return (
                    <div key={s.userId} className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setShares(shares.map((ss) =>
                            ss.userId === s.userId
                              ? { ...ss, included: !ss.included, amount: ss.included ? "" : ss.amount }
                              : ss
                          ))
                        }
                        className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          s.included ? "border-accent bg-accent" : "border-border bg-background"
                        }`}
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
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">
                            {currency.symbol}
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={s.amount}
                            onChange={(e) =>
                              setShares(shares.map((ss) =>
                                ss.userId === s.userId ? { ...ss, amount: e.target.value } : ss
                              ))
                            }
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
                  onClick={handleSplitEvenly}
                  disabled={includedCount === 0 || totalMinor <= 0}
                  className="px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-md hover:bg-accent/20 disabled:text-muted disabled:bg-background disabled:opacity-50"
                >
                  Split evenly ({includedCount})
                </button>
                {totalMinor > 0 && includedCount > 0 && (
                  <span className={`text-xs font-mono ${sharesMatch ? "text-positive" : "text-negative"}`}>
                    {fmt(sharesSum)} / {fmt(totalMinor)} {sharesMatch ? "✓" : "✗"}
                  </span>
                )}
              </div>
            </div>
          </>
        )}

        {isSettlement && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">From</label>
                <select
                  value={fromUserId}
                  onChange={(e) => setFromUserId(Number(e.target.value))}
                  className={`${inputCls} ${fromUserId === 0 ? "text-muted" : ""}`}
                >
                  <option value={0} disabled>Select...</option>
                  {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">To</label>
                <select
                  value={toUserId}
                  onChange={(e) => setToUserId(Number(e.target.value))}
                  className={`${inputCls} ${toUserId === 0 ? "text-muted" : ""}`}
                >
                  <option value={0} disabled>Select...</option>
                  {members.filter((u) => u.id !== fromUserId).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                  {currency.symbol}
                </span>
                <input type="text" inputMode="decimal" value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)} className={`${inputCls} pl-7`} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-background text-foreground hover:bg-muted/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-40"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
