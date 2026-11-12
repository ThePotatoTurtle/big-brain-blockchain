import { prisma } from "@/lib/db";
import type { PersonStatement, StatementEntry } from "@/lib/types";

/**
 * Everything that moved one person's main-ledger balance, newest first, with
 * the running balance after each entry. Trips keep their own balances, so only
 * their close-out transfer (a main-ledger entry) shows up here.
 */
export async function getPersonStatement(userId: number): Promise<PersonStatement> {
  const lines = await prisma.transactionLine.findMany({
    where: { userId, transaction: { status: "confirmed", tripId: null } },
    include: { transaction: true },
  });

  // Same ordering as the balance history, so running totals agree with the chart
  lines.sort(
    (a, b) =>
      a.transaction.date.getTime() - b.transaction.date.getTime() ||
      a.transaction.createdAt.getTime() - b.transaction.createdAt.getTime()
  );

  let running = 0;
  let creditsCents = 0;
  let debitsCents = 0;
  const entries: StatementEntry[] = [];
  for (const l of lines) {
    running += l.amount;
    if (l.amount > 0) creditsCents += l.amount;
    else debitsCents += l.amount;
    entries.push({
      id: l.transaction.id,
      date: l.transaction.date.toISOString().split("T")[0],
      item: l.transaction.item,
      type: l.transaction.type as "expense" | "settlement",
      isTransfer: l.transaction.transferJson != null,
      changeCents: l.amount,
      balanceAfterCents: running,
    });
  }

  return { userId, balanceCents: running, creditsCents, debitsCents, entries: entries.reverse() };
}
