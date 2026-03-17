"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { USERS } from "@/lib/users";
import { todayString, dollarsToCents, centsToDisplay } from "@/lib/utils";
import { computeProRataShares, formatReceiptNotes } from "@/lib/receipt";
import type { CreateTransactionRequest } from "@/lib/types";

type Phase = "upload" | "scanning" | "edit" | "submitting" | "done";

interface ReceiptItem {
  description: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  assignedUserIds: number[];
}

interface PayerEntry {
  id: string;
  userId: number;
  amount: string;
}

let payerIdCounter = 0;

/** Compress large images (esp. PNG clipboard pastes) to JPEG ≤ 4MB */
function compressImage(file: File, maxBytes = 4 * 1024 * 1024): Promise<File> {
  return new Promise((resolve) => {
    // Skip if already small enough or not an image
    if (file.size <= maxBytes) {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Scale down if very large dimensions
      let { width, height } = img;
      const maxDim = 2400;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressed = new File(
              [blob],
              file.name.replace(/\.\w+$/, ".jpg") || "receipt.jpg",
              { type: "image/jpeg" }
            );
            resolve(compressed);
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // fallback to original
    };
    img.src = url;
  });
}

export default function ReceiptForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Receipt file
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);

  // Header fields
  const [date, setDate] = useState(todayString());
  const [item, setItem] = useState("");
  const [notes, setNotes] = useState("");
  const [totalAmount, setTotalAmount] = useState("");

  // Multi-payer
  const [payers, setPayers] = useState<PayerEntry[]>([
    { id: `payer-${payerIdCounter++}`, userId: 0, amount: "" },
  ]);
  const isMultiPayer = payers.length > 1;
  const primaryPayerId = payers[0]?.userId ?? 0;

  const syncTotalFromPayers = (updatedPayers: PayerEntry[]) => {
    const sum = updatedPayers.reduce((s, p) => s + dollarsToCents(p.amount), 0);
    setTotalAmount(sum > 0 ? (sum / 100).toFixed(2) : "");
  };

  // Items
  const [items, setItems] = useState<ReceiptItem[]>([]);

  // Computed shares
  const totalCents = dollarsToCents(totalAmount);
  const itemsSubtotalCents = items.reduce(
    (s, it) => s + dollarsToCents(it.totalPrice),
    0
  );

  const computedShares = useMemo(() => {
    return computeProRataShares({
      items: items.map((it) => ({
        totalPriceCents: dollarsToCents(it.totalPrice),
        assignedUserIds: it.assignedUserIds,
      })),
      totalAmountCents: totalCents,
      primaryPayerUserId: primaryPayerId,
    });
  }, [items, totalCents, primaryPayerId]);

  const sharesSumCents = computedShares.reduce((s, sh) => s + sh.amountCents, 0);
  const sharesMatch = totalCents > 0 && sharesSumCents === totalCents;
  const assignedItemCount = items.filter((it) => it.assignedUserIds.length > 0).length;
  const unassignedCount = items.length - assignedItemCount;

  // Multi-payer validation
  const payerUserIds = new Set(payers.map((p) => p.userId));
  const allPayersSelected = payers.every((p) => p.userId > 0);
  const noDuplicatePayers =
    payerUserIds.size === payers.length || payers.some((p) => p.userId === 0);
  const payersSumCents = isMultiPayer
    ? payers.reduce((sum, p) => sum + dollarsToCents(p.amount), 0)
    : totalCents;
  const payersMatch = isMultiPayer
    ? totalCents > 0 && payersSumCents === totalCents
    : true;

  const hasOtherThanPayer = computedShares.some(
    (s) => !payerUserIds.has(s.userId)
  );

  const canSubmit =
    phase === "edit" &&
    item.trim() !== "" &&
    date !== "" &&
    allPayersSelected &&
    noDuplicatePayers &&
    payersMatch &&
    totalCents > 0 &&
    assignedItemCount > 0 &&
    hasOtherThanPayer &&
    sharesMatch;

  // Drag state
  const [isDragging, setIsDragging] = useState(false);

  // Paste from clipboard (global listener during upload phase)
  useEffect(() => {
    if (phase !== "upload") return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) acceptReceiptFile(file);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [phase]);

  // --- Handlers ---

  const acceptReceiptFile = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setError("Image too large (max 25MB)");
      return;
    }
    // Compress large images (clipboard PNGs can be huge)
    const compressed = await compressImage(file);
    setReceiptFile(compressed);
    setReceiptPreviewUrl(URL.createObjectURL(compressed));
    setError("");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptReceiptFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith("image/")
    );
    if (file) acceptReceiptFile(file);
  };

  const handleScan = async () => {
    if (!receiptFile) return;
    setPhase("scanning");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", receiptFile);

      const res = await fetch("/api/receipt-scan", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let msg = "Scan failed";
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          const text = await res.text().catch(() => "");
          if (res.status === 413 || text.toLowerCase().includes("too large")) {
            msg = "Image too large for scanning. Try a smaller photo.";
          }
        }
        throw new Error(msg);
      }

      const data = await res.json();

      // Populate fields from OCR
      if (data.supplierName) setItem(data.supplierName);
      if (data.date) setDate(data.date);
      // Don't auto-fill total — receipts don't include tip

      // Populate items
      const scannedItems: ReceiptItem[] = (data.lineItems ?? []).map(
        (li: { description: string; quantity: number; unitPrice: number | null; totalAmount: number | null }) => {
          const qty = li.quantity || 1;
          const total = li.totalAmount ?? (li.unitPrice ? li.unitPrice * qty : 0);
          const unit = li.unitPrice ?? (total / qty);
          return {
            description: li.description || "Item",
            quantity: qty,
            unitPrice: unit.toFixed(2),
            totalPrice: total.toFixed(2),
            assignedUserIds: [],
          };
        }
      );

      setItems(scannedItems.length > 0 ? scannedItems : [emptyItem()]);
      setPhase("edit");
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "Scan failed") +
          ". You can add items manually."
      );
      setItems([emptyItem()]);
      setPhase("edit");
    }
  };

  const handleSkipScan = () => {
    setItems([emptyItem()]);
    setPhase("edit");
  };

  const emptyItem = (): ReceiptItem => ({
    description: "",
    quantity: 1,
    unitPrice: "",
    totalPrice: "",
    assignedUserIds: [],
  });

  const updateItem = (idx: number, patch: Partial<ReceiptItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, ...patch };
        // Auto-compute totalPrice from qty * unit if unitPrice changed or qty changed
        if (("unitPrice" in patch || "quantity" in patch) && !("totalPrice" in patch)) {
          const unit = dollarsToCents(updated.unitPrice);
          const total = unit * updated.quantity;
          if (unit > 0) {
            updated.totalPrice = (total / 100).toFixed(2);
          }
        }
        return updated;
      })
    );
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()]);
  };

  const toggleUserOnItem = (itemIdx: number, userId: number) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== itemIdx) return it;
        const ids = new Set(it.assignedUserIds);
        if (ids.has(userId)) ids.delete(userId);
        else ids.add(userId);
        return { ...it, assignedUserIds: Array.from(ids) };
      })
    );
  };

  const setAllUsersOnItem = (itemIdx: number) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === itemIdx
          ? { ...it, assignedUserIds: USERS.map((u) => u.id) }
          : it
      )
    );
  };

  const clearUsersOnItem = (itemIdx: number) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === itemIdx ? { ...it, assignedUserIds: [] } : it
      )
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPhase("submitting");
    setError("");

    try {
      // Upload receipt file if present
      let attachmentUrls: { fileUrl: string; fileName: string }[] = [];
      if (receiptFile) {
        const uploadForm = new FormData();
        uploadForm.append("files", receiptFile);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: uploadForm,
        });
        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.json().catch(() => ({}));
          throw new Error(uploadErr.error || `Upload failed (${uploadRes.status})`);
        }
        const uploadData = await uploadRes.json();
        attachmentUrls = uploadData.files;
      }

      // Format notes
      const formattedNotes = formatReceiptNotes(
        items.filter((it) => it.assignedUserIds.length > 0),
        computedShares,
        itemsSubtotalCents,
        totalCents,
        notes.trim() || undefined
      );

      // Build payers payload
      const payersPayload = isMultiPayer
        ? payers.map((p) => ({
            userId: p.userId,
            amountCents: dollarsToCents(p.amount),
          }))
        : [{ userId: primaryPayerId, amountCents: totalCents }];

      const body: CreateTransactionRequest = {
        type: "expense",
        date,
        item: item.trim(),
        notes: formattedNotes,
        createdById: payers[0].userId,
        payers: payersPayload,
        totalAmountCents: totalCents,
        shares: computedShares.map((s) => ({
          userId: s.userId,
          amountCents: s.amountCents,
        })),
        attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      };

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create transaction");
      }

      setSuccess("Expense added!");
      setPhase("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("edit");
    }
  };

  const resetForm = () => {
    setPhase("upload");
    setReceiptFile(null);
    setReceiptPreviewUrl(null);
    setDate(todayString());
    setItem("");
    setNotes("");
    setTotalAmount("");
    setPayers([{ id: `payer-${payerIdCounter++}`, userId: 0, amount: "" }]);
    setItems([]);
    setError("");
    setSuccess("");
  };

  // --- Render ---

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
        Receipt Scanner
      </h2>

      {/* Upload Phase */}
      {phase === "upload" && (
        <div className="bg-card rounded-xl p-4 md:p-6 space-y-4">
          <label
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              isDragging
                ? "border-accent bg-accent/10"
                : "border-border hover:border-accent/50"
            }`}
          >
            {receiptPreviewUrl ? (
              <img
                src={receiptPreviewUrl}
                alt="Receipt preview"
                className="h-full max-h-36 object-contain rounded"
              />
            ) : (
              <div className="text-center">
                <svg
                  className="w-8 h-8 mx-auto text-muted mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span className="text-sm text-muted">
                  Tap, paste, or drag receipt here
                </span>
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>

          {error && (
            <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={handleScan}
            disabled={!receiptFile}
            className="w-full py-3 bg-accent text-white font-medium rounded-lg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Scan receipt
          </button>

          <button
            onClick={handleSkipScan}
            className="w-full py-2 text-sm text-accent hover:text-accent/80 transition-colors"
          >
            Skip scan, enter items manually
          </button>
        </div>
      )}

      {/* Scanning Phase */}
      {phase === "scanning" && (
        <div className="bg-card rounded-xl p-6 flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">Scanning receipt...</p>
        </div>
      )}

      {/* Edit Phase */}
      {(phase === "edit" || phase === "submitting") && (
        <div className="bg-card rounded-xl p-4 md:p-6 space-y-4">
          {/* Receipt thumbnail */}
          {receiptPreviewUrl && (
            <div className="flex justify-end">
              <img
                src={receiptPreviewUrl}
                alt="Receipt"
                className="h-16 rounded border border-border object-contain cursor-pointer hover:opacity-80"
                onClick={() => window.open(receiptPreviewUrl, "_blank")}
              />
            </div>
          )}

          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs text-muted mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full max-w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent appearance-none"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Restaurant / description
              </label>
              <input
                type="text"
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="Restaurant name..."
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any extra details..."
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>

          {/* Paid by + Total */}
          {!isMultiPayer && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">
                  Paid by
                </label>
                <select
                  value={primaryPayerId}
                  onChange={(e) =>
                    setPayers((prev) => [
                      { ...prev[0], userId: Number(e.target.value) },
                    ])
                  }
                  className={`w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${primaryPayerId === 0 ? "text-muted" : ""}`}
                >
                  <option value={0} disabled>
                    Select...
                  </option>
                  {USERS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    setPayers((prev) => [
                      { ...prev[0], amount: totalAmount },
                      {
                        id: `payer-${payerIdCounter++}`,
                        userId: 0,
                        amount: "",
                      },
                    ])
                  }
                  className="mt-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
                >
                  + Add payer
                </button>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  Total amount (incl. tax/tip)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          )}

          {isMultiPayer && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">
                  Total amount (incl. tax/tip)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  Paid by
                </label>
                <div className="space-y-2">
                  {payers.map((p) => {
                    const selectedByOthers = new Set(
                      payers
                        .filter((o) => o.id !== p.id && o.userId > 0)
                        .map((o) => o.userId)
                    );
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <select
                          value={p.userId}
                          onChange={(e) =>
                            setPayers((prev) =>
                              prev.map((pp) =>
                                pp.id === p.id
                                  ? { ...pp, userId: Number(e.target.value) }
                                  : pp
                              )
                            )
                          }
                          className={`flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent ${p.userId === 0 ? "text-muted" : ""}`}
                        >
                          <option value={0} disabled>
                            Select...
                          </option>
                          {USERS.map((u) => (
                            <option
                              key={u.id}
                              value={u.id}
                              disabled={selectedByOthers.has(u.id)}
                            >
                              {u.name}
                            </option>
                          ))}
                        </select>
                        <div className="relative flex-1">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">
                            $
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={p.amount}
                            onChange={(e) => {
                              const updated = payers.map((pp) =>
                                pp.id === p.id
                                  ? { ...pp, amount: e.target.value }
                                  : pp
                              );
                              setPayers(updated);
                              syncTotalFromPayers(updated);
                            }}
                            placeholder="0.00"
                            className="w-full bg-background border border-border rounded-lg pl-5 pr-2 py-2 text-sm focus:outline-none focus:border-accent"
                          />
                        </div>
                        <button
                          onClick={() => {
                            const updated = payers.filter(
                              (pp) => pp.id !== p.id
                            );
                            setPayers(updated);
                            if (updated.length > 1)
                              syncTotalFromPayers(updated);
                          }}
                          className="text-muted hover:text-negative text-lg leading-none px-1"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <button
                    onClick={() =>
                      setPayers((prev) => [
                        ...prev,
                        {
                          id: `payer-${payerIdCounter++}`,
                          userId: 0,
                          amount: "",
                        },
                      ])
                    }
                    className="text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    + Add payer
                  </button>
                  {totalCents > 0 && (
                    <span
                      className={`text-xs font-mono ${payersMatch ? "text-positive" : "text-negative"}`}
                    >
                      {centsToDisplay(payersSumCents)} /{" "}
                      {centsToDisplay(totalCents)}{" "}
                      {payersMatch ? "\u2713" : "\u2717"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Items */}
          <div>
            <label className="block text-xs text-muted mb-2">
              Items
            </label>
            <div className="space-y-3">
              {items.map((it, idx) => (
                <ReceiptItemRow
                  key={idx}
                  item={it}
                  onUpdate={(patch) => updateItem(idx, patch)}
                  onRemove={() => removeItem(idx)}
                  onToggleUser={(uid) => toggleUserOnItem(idx, uid)}
                  onSetAll={() => setAllUsersOnItem(idx)}
                  onClearAll={() => clearUsersOnItem(idx)}
                />
              ))}
            </div>
            <button
              onClick={addItem}
              className="mt-2 text-xs text-accent hover:text-accent/80 transition-colors"
            >
              + Add item
            </button>
            {items.length > 0 && (
              <div className="mt-2 text-xs text-muted text-right">
                Subtotal: {centsToDisplay(itemsSubtotalCents)}
                {itemsSubtotalCents > 0 &&
                  totalCents > 0 &&
                  totalCents !== itemsSubtotalCents && (
                    <span>
                      {" "}
                      ({((totalCents / itemsSubtotalCents - 1) * 100).toFixed(1)}
                      % tax/tip)
                    </span>
                  )}
              </div>
            )}
            {unassignedCount > 0 && (
              <div className="mt-1 text-xs text-amber-400">
                {unassignedCount} item{unassignedCount > 1 ? "s" : ""}{" "}
                unassigned
              </div>
            )}
          </div>

          {/* Split summary */}
          {computedShares.length > 0 && (
            <div>
              <label className="block text-xs text-muted mb-2">
                Split Summary
              </label>
              <div className="bg-background rounded-lg p-3 space-y-1.5">
                {computedShares.map((s) => {
                  const user = USERS.find((u) => u.id === s.userId);
                  return (
                    <div
                      key={s.userId}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: user?.color }}
                        />
                        <span>{user?.name}</span>
                      </div>
                      <span className="font-mono">
                        {centsToDisplay(s.amountCents)}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-border pt-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted">Total</span>
                  <span
                    className={`font-mono ${sharesMatch ? "text-positive" : "text-negative"}`}
                  >
                    {centsToDisplay(sharesSumCents)} /{" "}
                    {centsToDisplay(totalCents)}{" "}
                    {sharesMatch ? "\u2713" : "\u2717"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="text-negative text-sm bg-negative/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-3 bg-accent text-white font-medium rounded-lg transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase !== "edit" ? "Submitting..." : "Add expense"}
          </button>
        </div>
      )}

      {/* Done Phase */}
      {phase === "done" && (
        <div className="bg-card rounded-xl p-6 text-center space-y-4">
          {success && (
            <div className="text-positive text-sm bg-positive/10 rounded-lg px-3 py-2">
              {success}
            </div>
          )}
          <button
            onClick={resetForm}
            className="px-6 py-2 bg-accent text-white font-medium rounded-lg transition-colors hover:bg-accent/90"
          >
            Scan another receipt
          </button>
        </div>
      )}
    </div>
  );
}

// --- Item Row Component ---

function ReceiptItemRow({
  item,
  onUpdate,
  onRemove,
  onToggleUser,
  onSetAll,
  onClearAll,
}: {
  item: ReceiptItem;
  onUpdate: (patch: Partial<ReceiptItem>) => void;
  onRemove: () => void;
  onToggleUser: (userId: number) => void;
  onSetAll: () => void;
  onClearAll: () => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const assignedNames = item.assignedUserIds
    .map((id) => USERS.find((u) => u.id === id)?.name)
    .filter(Boolean);
  const label =
    assignedNames.length === 0
      ? "Assign..."
      : assignedNames.length === USERS.length
        ? "All"
        : assignedNames.join(", ");

  return (
    <div className="bg-background rounded-lg p-3 space-y-2">
      {/* Row 1: description + remove */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={item.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Item name"
          className="flex-1 bg-card border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
        />
        <button
          onClick={onRemove}
          className="text-muted hover:text-negative text-lg leading-none px-1 shrink-0"
        >
          &times;
        </button>
      </div>

      {/* Row 2: qty x unit = total */}
      <div className="flex items-center gap-1.5 text-xs">
        <input
          type="number"
          min={1}
          value={item.quantity}
          onChange={(e) =>
            onUpdate({ quantity: Math.max(1, parseInt(e.target.value) || 1) })
          }
          className="w-12 bg-card border border-border rounded-md px-1.5 py-1.5 text-xs text-center focus:outline-none focus:border-accent"
        />
        <span className="text-muted">&times;</span>
        <div className="relative flex-1">
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted text-xs">
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={item.unitPrice}
            onChange={(e) => onUpdate({ unitPrice: e.target.value })}
            placeholder="0.00"
            className="w-full bg-card border border-border rounded-md pl-4 pr-1.5 py-1.5 text-xs focus:outline-none focus:border-accent"
          />
        </div>
        <span className="text-muted">=</span>
        <div className="relative flex-1">
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted text-xs">
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={item.totalPrice}
            onChange={(e) => onUpdate({ totalPrice: e.target.value })}
            placeholder="0.00"
            className="w-full bg-card border border-border rounded-md pl-4 pr-1.5 py-1.5 text-xs focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Row 3: person multi-select */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={`w-full text-left bg-card border rounded-md px-2 py-1.5 text-xs transition-colors ${
            item.assignedUserIds.length === 0
              ? "border-amber-500/50 text-muted"
              : "border-border text-foreground"
          }`}
        >
          <span className="truncate block">{label}</span>
        </button>
        {dropdownOpen && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg py-1">
            <div className="flex gap-2 px-2 py-1 border-b border-border">
              <button
                onClick={onSetAll}
                className="text-xs text-accent hover:text-accent/80"
              >
                All
              </button>
              <button
                onClick={onClearAll}
                className="text-xs text-muted hover:text-foreground"
              >
                None
              </button>
            </div>
            {USERS.map((u) => {
              const checked = item.assignedUserIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => onToggleUser(u.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-card-hover text-xs text-left"
                >
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? "border-accent bg-accent"
                        : "border-border bg-background"
                    }`}
                  >
                    {checked && (
                      <svg
                        className="w-2.5 h-2.5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: u.color }}
                  />
                  <span>{u.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
