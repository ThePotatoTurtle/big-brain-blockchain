import { prisma } from "@/lib/db";
import { USERS } from "@/lib/users";
import type { TripTransferSummary } from "@/lib/types";

type Split = { userId: number; amountCents: number }[];

export interface MonthlyDigest {
  month: string; // "2026-10"
  label: string; // "October 2026"
  endDate: string; // last day of the month, YYYY-MM-DD
  /** Main-ledger expense totals, rebates netted off. Trip transfers excluded. */
  spentCents: number;
  expenseCount: number;
  settlementCount: number;
  settledCents: number;
  biggest: { item: string; amountCents: number; payerIds: number[] } | null;
  /** Whoever's shares added up to the most (entries with stored shares only). */
  topSpender: { userId: number; amountCents: number } | null;
  /** Net balance change over the month, non-zero only, biggest move first. */
  changes: Split;
  /** Balances at the end of the month, lowest first. */
  balances: Split;
  /** Trips whose balances were transferred into the main ledger this month. */
  tripsClosed: string[];
}

const DIGEST_TIME_ZONE = "America/Vancouver";

/** "YYYY-MM" of the month before the current one, in the group's time zone. */
export function previousMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DIGEST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return prev.toISOString().slice(0, 7);
}

/**
 * Summarise one month of the main ledger. Returns null when nothing was
 * logged that month (the digest is skipped rather than posted empty).
 */
export async function buildMonthlyDigest(month: string): Promise<MonthlyDigest | null> {
  const [year, mon] = month.split("-").map(Number);
  // Dates are stored as date-only (UTC midnight), so UTC bounds are exact
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));

  // Sequential queries — the PrismaPg adapter is slow with concurrent queries
  const transactions = await prisma.transaction.findMany({
    where: { status: "confirmed", tripId: null, date: { gte: start, lte: end } },
    include: { lines: true },
  });
  if (transactions.length === 0) return null;

  const balanceRows = await prisma.transactionLine.groupBy({
    by: ["userId"],
    _sum: { amount: true },
    where: { transaction: { status: "confirmed", tripId: null, date: { lte: end } } },
  });

  let spentCents = 0;
  let expenseCount = 0;
  let settlementCount = 0;
  let settledCents = 0;
  let biggest: MonthlyDigest["biggest"] = null;
  const spendByUser = new Map<number, number>();
  const changeByUser = new Map<number, number>();
  const tripsClosed: string[] = [];

  for (const t of transactions) {
    for (const l of t.lines) {
      changeByUser.set(l.userId, (changeByUser.get(l.userId) ?? 0) + l.amount);
    }

    if (t.transferJson) {
      tripsClosed.push((t.transferJson as unknown as TripTransferSummary).tripName);
      continue;
    }

    if (t.type === "settlement") {
      settlementCount++;
      settledCents += t.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
      continue;
    }

    const total = t.totalAmountCents ?? 0;
    expenseCount++;
    spentCents += total;
    for (const s of (t.sharesJson as Split | null) ?? []) {
      spendByUser.set(s.userId, (spendByUser.get(s.userId) ?? 0) + s.amountCents);
    }
    if (total > 0 && (!biggest || total > biggest.amountCents)) {
      const payers = (t.payersJson as Split | null) ?? [];
      biggest = {
        item: t.item,
        amountCents: total,
        payerIds: payers.length
          ? payers.map((p) => p.userId)
          : t.lines.filter((l) => l.amount > 0).map((l) => l.userId),
      };
    }
  }

  const top = Array.from(spendByUser).sort((a, b) => b[1] - a[1])[0];
  const balanceMap = new Map(balanceRows.map((r) => [r.userId, r._sum.amount ?? 0]));

  return {
    month,
    label: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    endDate: end.toISOString().split("T")[0],
    spentCents,
    expenseCount,
    settlementCount,
    settledCents,
    biggest,
    topSpender: top && top[1] > 0 ? { userId: top[0], amountCents: top[1] } : null,
    changes: Array.from(changeByUser)
      .filter(([, amountCents]) => amountCents !== 0)
      .map(([userId, amountCents]) => ({ userId, amountCents }))
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
    balances: USERS.map((u) => ({ userId: u.id, amountCents: balanceMap.get(u.id) ?? 0 })).sort(
      (a, b) => a.amountCents - b.amountCents
    ),
    tripsClosed,
  };
}
