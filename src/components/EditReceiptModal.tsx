"use client";

import { useState, useMemo } from "react";
import { USERS } from "@/lib/users";
import { centsToDisplay } from "@/lib/utils";
import { computeProRataShares, formatReceiptNotes, parseReceiptNotes } from "@/lib/receipt";
import { ReceiptItemRow } from "@/components/ReceiptForm";
import { toMinorUnits, formatMoney, type TripConfig, type TripCurrency } from "@/lib/trips";
import type { TransactionWithDetails } from "@/lib/types";

const CAD_DEFAULT: TripCurrency = { code: "CAD", symbol: "$", decimals: 2 };

let payerIdCounter = 0;

interface PayerEntry {
  id: string;
  userId: number;
  amount: string;
}

export default function EditReceiptModal({
  transaction: t,
  trip,
  onClose,
  onSaved,
}: {
  transaction: TransactionWithDetails;
  /** When set: trip members only, entry currency honored, category/method editable. */
  trip?: TripConfig;
  onClose: () => void;
  onSaved: (refreshed: TransactionWithDetails[]) => void;
}) {
  const members = trip ? USERS.filter((u) => trip.memberIds.includes(u.id)) : [...USERS];
  const currencyDef: TripCurrency =
    trip?.currencies.find((c) => c.code === t.currency) ?? CAD_DEFAULT;
  const toMinor = (v: string | number) => toMinorUnits(v, currencyDef.decimals);
  const fmt = (n: number) => (trip ? formatMoney(n, currencyDef) : centsToDisplay(n));
  const minorToInput = (minor: number) =>
    (minor / Math.pow(10, currencyDef.decimals)).toFixed(currencyDef.decimals);

  const payerLines = t.lines.filter((l) => l.amount > 0);
  const total = t.totalAmountCents ?? payerLines.reduce((s, l) => s + l.amount, 0);

  // Pre-populate payers: stored payersJson is exact; fall back to line-derived
  const initPayers: PayerEntry[] =
    t.payers && t.payers.length > 0
      ? t.payers.length === 1
        ? [{ id: `rp-${payerIdCounter++}`, userId: t.payers[0].userId, amount: minorToInput(total) }]
        : t.payers.map((p) => ({
            id: `rp-${payerIdCounter++}`,
            userId: p.userId,
            amount: minorToInput(p.amountCents),
          }))
      : payerLines.length === 1
        ? [{ id: `rp-${payerIdCounter++}`, userId: payerLines[0].userId, amount: minorToInput(total) }]
        : payerLines.map((l) => ({ id: `rp-${payerIdCounter++}`, userId: l.userId, amount: "" }));

  const parsedItems = parseReceiptNotes(t.notes ?? "", currencyDef.decimals) ?? [];

  const [date, setDate] = useState(t.date);
  const [item, setItem] = useState(t.item);
  const [notes, setNotes] = useState(""); // user-level notes (not the receipt block)
  const [totalAmount, setTotalAmount] = useState(minorToInput(total));
  const [payers, setPayers] = useState<PayerEntry[]>(initPayers);
  const [items, setItems] = useState(parsedItems);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Trip fields. A renamed/removed category can't be saved back (the API
  // rejects unknown categories), so start unset and surface the old value.
  const legacyCategory =
    trip && t.category && !trip.categories.includes(t.category) ? t.category : null;
  const [category, setCategory] = useState(legacyCategory ? "" : t.category ?? "");
  const initMethodKnown = !t.paymentMethod || (trip?.paymentMethods.includes(t.paymentMethod) ?? false);
  const [method, setMethod] = useState(
    t.paymentMethod ? (initMethodKnown ? t.paymentMethod : "Others") : ""
  );
  const [methodOther, setMethodOther] = useState(initMethodKnown ? "" : t.paymentMethod ?? "");

  const isMultiPayer = payers.length > 1;
  const primaryPayerId = payers[0]?.userId ?? 0;
  const totalCents = toMinor(totalAmount);
  const itemsSubtotalCents = items.reduce((s, it) => s + toMinor(it.totalPrice), 0);

  const syncTotalFromPayers = (updated: PayerEntry[]) => {
    const sum = updated.reduce((s, p) => s + toMinor(p.amount), 0);
    setTotalAmount(sum > 0 ? minorToInput(sum) : "");
  };

  const computedShares = useMemo(() => computeProRataShares({
    items: items.map((it) => ({
      totalPriceCents: toMinorUnits(it.totalPrice, currencyDef.decimals),
      assignedUserIds: it.assignedUserIds,
    })),
    totalAmountCents: totalCents,
    primaryPayerUserId: primaryPayerId,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, totalCents, primaryPayerId, currencyDef.decimals]);

  const sharesSumCents = computedShares.reduce((s, sh) => s + sh.amountCents, 0);
  const sharesMatch = totalCents > 0 && sharesSumCents === totalCents;
  const assignedItemCount = items.filter((it) => it.assignedUserIds.length > 0).length;
  const unassignedCount = items.length - assignedItemCount;
  const payerUserIds = new Set(payers.map((p) => p.userId));
  const payersSumCents = isMultiPayer ? payers.reduce((s, p) => s + toMinor(p.amount), 0) : totalCents;
  const payersMatch = isMultiPayer ? totalCents > 0 && payersSumCents === totalCents : true;
  // Trips allow self entries (payer is the only person assigned)
  const hasOtherThanPayer = !!trip || computedShares.some((s) => !payerUserIds.has(s.userId));

  const canSubmit =
    item.trim() && date &&
    payers.every((p) => p.userId > 0) &&
    payersMatch && totalCents > 0 &&
    assignedItemCount > 0 && hasOtherThanPayer && sharesMatch &&
    (!trip || category !== "");

  const updateItem = (idx: number, patch: Partial<typeof items[0]>) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, ...patch };
      if (("unitPrice" in patch || "quantity" in patch) && !("totalPrice" in patch)) {
        const unit = toMinor(updated.unitPrice);
        if (unit > 0) updated.totalPrice = minorToInput(unit * updated.quantity);
      }
      return updated;
    }));
  };

  const toggleUserOnItem = (itemIdx: number, userId: number) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== itemIdx) return it;
      const ids = new Set(it.assignedUserIds);
      ids.has(userId) ? ids.delete(userId) : ids.add(userId);
      return { ...it, assignedUserIds: Array.from(ids) };
    }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const formattedNotes = formatReceiptNotes(
        items.filter((it) => it.assignedUserIds.length > 0),
        computedShares,
        itemsSubtotalCents,
        totalCents,
        notes.trim() || undefined,
        trip ? currencyDef : undefined,
      );
      const payersPayload = isMultiPayer
        ? payers.map((p) => ({ userId: p.userId, amountCents: toMinor(p.amount) }))
        : [{ userId: primaryPayerId, amountCents: totalCents }];

      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: t.id,
          type: "expense",
          date,
          item: item.trim(),
          notes: formattedNotes,
          createdById: payers[0].userId,
          payers: payersPayload,
          totalAmountCents: totalCents,
          shares: computedShares.map((s) => ({ userId: s.userId, amountCents: s.amountCents })),
          ...(trip
            ? {
                currency: currencyDef.code,
                category,
                paymentMethod:
                  (method === "Others" ? methodOther.trim() : method) || undefined,
              }
            : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }

      // Refresh list (trip-scoped when editing a trip entry)
      const refreshRes = await fetch(
        `/api/transactions?page=1&limit=100${trip ? `&trip=${trip.slug}` : ""}`
      );
      const refreshData = await refreshRes.json();
      onSaved(refreshData.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const emptyItem = () => ({ description: "", quantity: 1, unitPrice: "", totalPrice: "", assignedUserIds: [] });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !submitting && onClose()}>
      <div className="bg-card rounded-xl p-5 mx-4 max-w-md w-full shadow-lg max-h-[90vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">
          Edit receipt entry
          {trip && <span className="text-muted font-normal"> — {currencyDef.code}</span>}
        </h3>

        {/* Date & Item */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent appearance-none" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Restaurant</label>
            <input type="text" value={item} onChange={(e) => setItem(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          </div>
        </div>

        {/* Trip fields */}
        {trip && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${category === "" ? "text-muted" : ""}`}
              >
                <option value="" disabled>Select...</option>
                {trip.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {legacyCategory && category === "" && (
                <p className="text-[11px] text-amber-400 mt-1">
                  Was &ldquo;{legacyCategory}&rdquo; — no longer available, pick a new one.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Payment method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${method === "" ? "text-muted" : ""}`}
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
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent mt-1.5"
                />
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-muted mb-1">Notes (optional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra details..."
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
        </div>

        {/* Payers + Total */}
        {!isMultiPayer ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Paid by</label>
              <select value={primaryPayerId} onChange={(e) => setPayers([{ ...payers[0], userId: Number(e.target.value) }])}
                className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${primaryPayerId === 0 ? "text-muted" : ""}`}>
                <option value={0} disabled>Select...</option>
                {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button onClick={() => setPayers([{ ...payers[0], amount: totalAmount }, { id: `rp-${payerIdCounter++}`, userId: 0, amount: "" }])}
                className="mt-1.5 text-xs text-accent hover:text-accent/80">+ Add payer</button>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Total (incl. tax/tip)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">{currencyDef.symbol}</span>
                <input type="text" inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-muted mb-1">Total (incl. tax/tip)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">{currencyDef.symbol}</span>
                <input type="text" inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent" />
              </div>
            </div>
            {payers.map((p) => {
              const others = new Set(payers.filter((o) => o.id !== p.id && o.userId > 0).map((o) => o.userId));
              return (
                <div key={p.id} className="flex gap-2">
                  <select value={p.userId} onChange={(e) => setPayers(payers.map((pp) => pp.id === p.id ? { ...pp, userId: Number(e.target.value) } : pp))}
                    className={`flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${p.userId === 0 ? "text-muted" : ""}`}>
                    <option value={0} disabled>Select...</option>
                    {members.map((u) => <option key={u.id} value={u.id} disabled={others.has(u.id)}>{u.name}</option>)}
                  </select>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">{currencyDef.symbol}</span>
                    <input type="text" inputMode="decimal" value={p.amount}
                      onChange={(e) => { const u = payers.map((pp) => pp.id === p.id ? { ...pp, amount: e.target.value } : pp); setPayers(u); syncTotalFromPayers(u); }}
                      className="w-full bg-background border border-border rounded-lg pl-5 pr-2 py-2 text-sm focus:outline-none focus:border-accent" />
                  </div>
                  <button onClick={() => setPayers(payers.filter((pp) => pp.id !== p.id))} className="text-muted hover:text-negative text-lg leading-none px-1">&times;</button>
                </div>
              );
            })}
            <div className="flex justify-between">
              <button onClick={() => setPayers([...payers, { id: `rp-${payerIdCounter++}`, userId: 0, amount: "" }])} className="text-xs text-accent hover:text-accent/80">+ Add payer</button>
              {totalCents > 0 && <span className={`text-xs font-mono ${payersMatch ? "text-positive" : "text-negative"}`}>{fmt(payersSumCents)} / {fmt(totalCents)} {payersMatch ? "✓" : "✗"}</span>}
            </div>
          </div>
        )}

        {/* Items */}
        <div>
          <label className="block text-xs text-muted mb-2">Items</label>
          <div className="space-y-3">
            {items.map((it, idx) => (
              <ReceiptItemRow key={idx} item={it}
                members={members}
                symbol={currencyDef.symbol}
                onUpdate={(patch) => updateItem(idx, patch)}
                onRemove={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                onToggleUser={(uid) => toggleUserOnItem(idx, uid)}
                onSetAll={() => setItems((prev) => prev.map((it2, i) => i === idx ? { ...it2, assignedUserIds: members.map((u) => u.id) } : it2))}
                onClearAll={() => setItems((prev) => prev.map((it2, i) => i === idx ? { ...it2, assignedUserIds: [] } : it2))}
              />
            ))}
          </div>
          <button onClick={() => setItems((prev) => [...prev, emptyItem()])} className="mt-2 text-xs text-accent hover:text-accent/80">+ Add item</button>
          {items.length > 0 && (
            <div className="mt-1 text-xs text-muted text-right">
              Subtotal: {fmt(itemsSubtotalCents)}
              {itemsSubtotalCents > 0 && totalCents > 0 && totalCents !== itemsSubtotalCents && (
                <span> ({((totalCents / itemsSubtotalCents - 1) * 100).toFixed(1)}% tax/tip)</span>
              )}
            </div>
          )}
          {unassignedCount > 0 && <div className="mt-1 text-xs text-amber-400">{unassignedCount} item{unassignedCount > 1 ? "s" : ""} unassigned</div>}
        </div>

        {/* Split summary */}
        {computedShares.length > 0 && (
          <div className="bg-background rounded-lg p-3 space-y-1.5">
            {computedShares.map((s) => {
              const user = USERS.find((u) => u.id === s.userId);
              return (
                <div key={s.userId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: user?.color }} />
                    <span>{user?.name}</span>
                  </div>
                  <span className="font-mono">{fmt(s.amountCents)}</span>
                </div>
              );
            })}
            <div className="border-t border-border pt-1.5 flex justify-between text-xs">
              <span className="text-muted">Total</span>
              <span className={`font-mono ${sharesMatch ? "text-positive" : "text-negative"}`}>
                {fmt(sharesSumCents)} / {fmt(totalCents)} {sharesMatch ? "✓" : "✗"}
              </span>
            </div>
          </div>
        )}

        {error && <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm rounded-lg bg-background text-foreground hover:bg-muted/20 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit || submitting} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-40">
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
