import { centsToDisplay } from "@/lib/utils";
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
 * `decimals` matches the entry's currency (2 for CAD, 0 for JPY).
 */
export function parseReceiptNotes(
  notes: string,
  decimals = 2
): ParsedReceiptItem[] | null {
  if (!isReceiptNotes(notes)) return null;

  const lines = notes.split("\n");
  const startIdx = lines.findIndex((l) => l === "Receipt items:");
  if (startIdx === -1) return null;

  const items: ParsedReceiptItem[] = [];
  // e.g. "1. Sushi Roll (x2) $13.90 — Danny, Timmy"
  // or   "1. Tonkotsu Ramen ¥1,250 — All"
  const itemRe = /^\d+\. (.+?) [$¥]([\d,.]+) — (.+)$/;
  const qtyRe = /^(.*?) \(x(\d+)\)$/;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("Items subtotal:") || line === "---") break;

    const m = itemRe.exec(line);
    if (!m) continue;

    let description = m[1];
    const totalPrice = m[2].replace(/,/g, "");
    const peopleStr = m[3];

    // Extract optional (xN) quantity suffix from description
    let quantity = 1;
    const qm = qtyRe.exec(description);
    if (qm) {
      description = qm[1];
      quantity = parseInt(qm[2]) || 1;
    }

    const factor = Math.pow(10, decimals);
    const totalMinor = Math.round(parseFloat(totalPrice) * factor);
    const unitPrice = quantity > 1
      ? (totalMinor / quantity / factor).toFixed(decimals)
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
 * Rounding happens ONCE, at the very end. Each item is split among its
 * assignees as an exact fraction (no per-item rounding), so leftover cents
 * never accumulate on whoever happens to be listed first. A single
 * largest-remainder pass then rounds every person to whole cents such that
 * the shares sum exactly to totalAmountCents.
 *
 * 1. For each item, add (price / nAssignees) — a fraction — to each assignee.
 * 2. Scale every fractional subtotal proportionally to totalAmountCents.
 * 3. Floor each, then hand out the few leftover cents to whoever was rounded
 *    down the most (primary payer wins exact ties).
 *
 * Returns shares summing exactly to totalAmountCents.
 */
export function computeProRataShares(input: ProRataInput): ProRataShare[] {
  const { items, totalAmountCents, primaryPayerUserId } = input;

  if (totalAmountCents <= 0) return [];

  // Step 1: accumulate each person's EXACT (fractional) subtotal in cents.
  // Splitting items as fractions defers all rounding to the final step.
  const personSubtotal = new Map<number, number>();

  for (const item of items) {
    if (item.assignedUserIds.length === 0 || item.totalPriceCents <= 0) continue;
    const perPerson = item.totalPriceCents / item.assignedUserIds.length;
    for (const uid of item.assignedUserIds) {
      personSubtotal.set(uid, (personSubtotal.get(uid) ?? 0) + perPerson);
    }
  }

  const grandTotal = Array.from(personSubtotal.values()).reduce((s, c) => s + c, 0);
  if (grandTotal === 0) return [];

  // Step 2 & 3: scale to actual total, then floor and capture the lost fraction.
  const entries = Array.from(personSubtotal.entries());
  const rawShares = entries.map(([userId, subtotal]) => {
    const exact = (subtotal / grandTotal) * totalAmountCents;
    const shareCents = Math.floor(exact);
    return { userId, shareCents, fractionalLoss: exact - shareCents };
  });

  // Final (and only) rounding step: distribute the handful of leftover cents
  // by largest fractional loss. Primary payer only breaks exact ties, so the
  // same person no longer absorbs rounding on every item.
  const distributed = rawShares.reduce((s, r) => s + r.shareCents, 0);
  let remainderCents = totalAmountCents - distributed;

  rawShares.sort((a, b) => {
    if (b.fractionalLoss !== a.fractionalLoss) return b.fractionalLoss - a.fractionalLoss;
    if (a.userId === primaryPayerUserId) return -1;
    if (b.userId === primaryPayerUserId) return 1;
    return 0;
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
  /** Currency formatting override (e.g. JPY). Defaults to CAD dollars. */
  currency?: { symbol: string; decimals: number },
): string {
  const lines: string[] = [];
  const sym = currency?.symbol ?? "$";
  const fmt = (minor: number) =>
    currency
      ? `${sym}${(Math.abs(minor) / Math.pow(10, currency.decimals)).toLocaleString("en-US", {
          minimumFractionDigits: currency.decimals,
          maximumFractionDigits: currency.decimals,
        })}`
      : centsToDisplay(minor);

  if (userNotes?.trim()) {
    lines.push(userNotes.trim());
    lines.push("");
  }

  lines.push("Receipt items:");
  items.forEach((item, i) => {
    const qty = item.quantity > 1 ? ` (x${item.quantity})` : "";
    const names = item.assignedUserIds.map((id) => USERS.find((u) => u.id === id)?.name ?? "?");
    const people = names.length === USERS.length ? "All" : names.join(", ");
    lines.push(`${i + 1}. ${item.description}${qty} ${sym}${item.totalPrice} — ${people}`);
  });

  lines.push(`Items subtotal: ${fmt(itemsSubtotalCents)}`);

  if (itemsSubtotalCents > 0 && totalAmountCents !== itemsSubtotalCents) {
    const markup = ((totalAmountCents / itemsSubtotalCents - 1) * 100).toFixed(1);
    lines.push(`Tax/tip markup: ${markup}%`);
  }

  lines.push("---");
  const splitParts = shares.map((s) => {
    const name = USERS.find((u) => u.id === s.userId)?.name ?? "?";
    return `${name} ${fmt(s.amountCents)}`;
  });
  lines.push(`Split: ${splitParts.join(", ")}`);

  return lines.join("\n");
}
