import { prisma } from "@/lib/db";
import { getUserById } from "@/lib/users";
import type { TransactionWithDetails, TransactionLineDetail } from "@/lib/types";
import type { TransactionFilters } from "@/lib/transaction-filters";

type Split = { userId: number; amountCents: number }[];

/**
 * Fetch one page of transactions, newest first, in the shape the client renders.
 * The single source for both the server-rendered Transactions page and
 * GET /api/transactions. Add new fields here so neither path drifts.
 *
 * tripId: a trip slug for that trip's entries, or null for the main ledger.
 */
export async function getTransactionsPage({
  tripId,
  skip,
  take,
  filters = {},
}: {
  tripId: string | null;
  skip: number;
  take: number;
  filters?: TransactionFilters;
}): Promise<{ transactions: TransactionWithDetails[]; total: number }> {
  // Workaround: Prisma 7 PrismaPg adapter is extremely slow with concurrent queries
  // and multiple includes. Query sequentially and merge in application code.
  const q = filters.q?.trim();
  const where = {
    tripId,
    ...(filters.id ? { id: filters.id } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.userId ? { lines: { some: { userId: filters.userId } } } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { item: { contains: q, mode: "insensitive" as const } },
            { notes: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const baseTransactions = await prisma.transaction.findMany({
    where,
    include: { createdBy: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    skip,
    take,
  });
  const total = await prisma.transaction.count({ where });

  if (baseTransactions.length === 0) return { transactions: [], total };

  const txIds = baseTransactions.map((t) => t.id);
  const lines = await prisma.transactionLine.findMany({
    where: { transactionId: { in: txIds } },
    include: { user: true },
  });
  const attachments = await prisma.attachment.findMany({
    where: { transactionId: { in: txIds } },
  });

  const linesMap = new Map<number, typeof lines>();
  for (const l of lines) {
    const arr = linesMap.get(l.transactionId) ?? [];
    arr.push(l);
    linesMap.set(l.transactionId, arr);
  }
  const attachMap = new Map<number, typeof attachments>();
  for (const a of attachments) {
    const arr = attachMap.get(a.transactionId) ?? [];
    arr.push(a);
    attachMap.set(a.transactionId, arr);
  }

  const transactions = baseTransactions.map((t): TransactionWithDetails => ({
    id: t.id,
    date: t.date.toISOString().split("T")[0],
    type: t.type as "expense" | "settlement",
    item: t.item,
    notes: t.notes,
    totalAmountCents: t.totalAmountCents,
    status: t.status as "pending" | "confirmed",
    createdBy: { id: t.createdBy.id, name: t.createdBy.name },
    lines: (linesMap.get(t.id) ?? []).map(
      (l): TransactionLineDetail => ({
        userId: l.user.id,
        userName: l.user.name,
        amount: l.amount,
        color: getUserById(l.user.id)?.color ?? "#6B7280",
      })
    ),
    attachments: (attachMap.get(t.id) ?? []).map((a) => ({
      id: a.id,
      fileUrl: a.fileUrl,
      fileName: a.fileName,
    })),
    createdAt: t.createdAt.toISOString(),
    tripId: t.tripId,
    currency: t.currency,
    paymentMethod: t.paymentMethod,
    category: t.category,
    shares: (t.sharesJson as Split | null) ?? null,
    payers: (t.payersJson as Split | null) ?? null,
    conversionBatchId: t.conversionBatchId,
    transfer: (t.transferJson as TransactionWithDetails["transfer"]) ?? null,
  }));

  return { transactions, total };
}
