import { dollarsToCents, centsToDisplay } from "@/lib/utils";
import { USERS } from "@/lib/users";

export interface ParsedReceiptItem {
  description: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  assignedUserIds: number[];
}

/**
 * Detect whether a notes string came from the receipt scanner.
 */
export function isReceiptNotes(notes: string | null | undefined): boolean {
  return !!notes && notes.includes("Receipt items:");
}

/**
 * Parse a formatReceiptNotes() string back into receipt items.
 * Returns null if the notes don't look like a receipt entry.
 */
export function parseReceiptNotes(notes: string): ParsedReceiptItem[] | null {
  if (!isReceiptNotes(notes)) return null;

  const lines = notes.split("\n");
  const startIdx = lines.findIndex((l) => l === "Receipt items:");
  if (startIdx === -1) return null;

  const items: ParsedReceiptItem[] = [];
  // e.g. "1. Sushi Roll (x2) $13.90 — Danny, Timmy"
  // or   "1. Sushi Roll $13.90 — All"
  const itemRe = /^\d+\. (.+?) \$(\S+) — (.+)$/;
  const qtyRe = /^(.*?) \(x(\d+)\)$/;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("Items subtotal:") || line === "---") break;

    const m = itemRe.exec(line);
    if (!m) continue;

    let description = m[1];
    const totalPrice = m[2];
    const peopleStr = m[3];

    // Extract optional (xN) quantity suffix from description
    let quantity = 1;
    const qm = qtyRe.exec(description);
    if (qm) {
      description = qm[1];
      quantity = parseInt(qm[2]) || 1;
    }

    const unitPrice = quantity > 1
      ? (dollarsToCents(totalPrice) / quantity / 100).toFixed(2)
      : totalPrice;

    let assignedUserIds: number[];
    if (peopleStr === "All") {
      assignedUserIds = USERS.map((u) => u.id);
    } else {
      assignedUserIds = peopleStr
        .split(", ")
        .flatMap((name) => {
          const id = USERS.find((u) => u.name === name.trim())?.id;
          return id !== undefined ? [id] : [];
        });
    }

    items.push({ description, quantity, unitPrice, totalPrice, assignedUserIds });
  }

  return items.length > 0 ? items : null;
}

interface ProRataInput {
  items: { totalPriceCents: number; assignedUserIds: number[] }[];
  totalAmountCents: number;
  primaryPayerUserId: number;
}

export interface ProRataShare {
  userId: number;
  amountCents: number;
}

/**
 * Compute pro rata shares from item assignments.
 *
 * 1. For each item, split cost evenly among assigned people (floor + remainder).
 * 2. Sum each person's item costs → their "subtotal".
 * 3. Scale proportionally to totalAmountCents (handles tax/tip).
 * 4. Distribute remainder cents: primary payer first, then by fractional loss.
 *
 * Returns shares summing exactly to totalAmountCents.
 */
export function computeProRataShares(input: ProRataInput): ProRataShare[] {
  const { items, totalAmountCents, primaryPayerUserId } = input;

  if (totalAmountCents <= 0) return [];

  // Step 1 & 2: compute each person's item subtotal in cents
  const personSubtotal = new Map<number, number>();

  for (const item of items) {
    if (item.assignedUserIds.length === 0 || item.totalPriceCents <= 0) continue;
    const n = item.assignedUserIds.length;
    const base = Math.floor(item.totalPriceCents / n);
    const remainder = item.totalPriceCents - base * n;

    for (let i = 0; i < n; i++) {
      const uid = item.assignedUserIds[i];
      const share = base + (i < remainder ? 1 : 0);
      personSubtotal.set(uid, (personSubtotal.get(uid) ?? 0) + share);
    }
  }

  const grandTotal = Array.from(personSubtotal.values()).reduce((s, c) => s + c, 0);
  if (grandTotal === 0) return [];

  // Step 3: scale to actual total
  const entries = Array.from(personSubtotal.entries());
  const rawShares = entries.map(([userId, subtotal]) => ({
    userId,
    subtotal,
    shareCents: Math.floor((subtotal / grandTotal) * totalAmountCents),
    fractionalLoss: (subtotal / grandTotal) * totalAmountCents -
      Math.floor((subtotal / grandTotal) * totalAmountCents),
  }));

  // Step 4: distribute remainder cents
  let distributed = rawShares.reduce((s, r) => s + r.shareCents, 0);
  let remainderCents = totalAmountCents - distributed;

  rawShares.sort((a, b) => {
    if (a.userId === primaryPayerUserId) return -1;
    if (b.userId === primaryPayerUserId) return 1;
    return b.fractionalLoss - a.fractionalLoss;
  });

  for (let i = 0; remainderCents > 0 && i < rawShares.length; i++) {
    rawShares[i].shareCents++;
    remainderCents--;
  }

  return rawShares.map(({ userId, shareCents }) => ({
    userId,
    amountCents: shareCents,
  }));
}

/**
 * Format receipt items and split into readable text for the notes field.
 */
export function formatReceiptNotes(
  items: { description: string; quantity: number; totalPrice: string; assignedUserIds: number[] }[],
  shares: ProRataShare[],
  itemsSubtotalCents: number,
  totalAmountCents: number,
  userNotes?: string,
): string {
  const lines: string[] = [];

  if (userNotes?.trim()) {
    lines.push(userNotes.trim());
    lines.push("");
  }

  lines.push("Receipt items:");
  items.forEach((item, i) => {
    const qty = item.quantity > 1 ? ` (x${item.quantity})` : "";
    const names = item.assignedUserIds.map((id) => USERS.find((u) => u.id === id)?.name ?? "?");
    const people = names.length === USERS.length ? "All" : names.join(", ");
    lines.push(`${i + 1}. ${item.description}${qty} $${item.totalPrice} — ${people}`);
  });

  lines.push(`Items subtotal: ${centsToDisplay(itemsSubtotalCents)}`);

  if (itemsSubtotalCents > 0 && totalAmountCents !== itemsSubtotalCents) {
    const markup = ((totalAmountCents / itemsSubtotalCents - 1) * 100).toFixed(1);
    lines.push(`Tax/tip markup: ${markup}%`);
  }

  lines.push("---");
  const splitParts = shares.map((s) => {
    const name = USERS.find((u) => u.id === s.userId)?.name ?? "?";
    return `${name} ${centsToDisplay(s.amountCents)}`;
  });
  lines.push(`Split: ${splitParts.join(", ")}`);

  return lines.join("\n");
}
