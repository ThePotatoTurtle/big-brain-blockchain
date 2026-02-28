import { prisma } from "@/lib/db";
import { getUserById } from "@/lib/users";
import type { TransactionWithDetails, TransactionLineDetail } from "@/lib/types";
import TransactionList from "@/components/TransactionList";

async function getTransactions() {
  // Workaround: Prisma 7 PrismaPg adapter has a bug where multiple includes
  // adds ~10s per extra include. Query separately and merge in application code.
  // Sequential queries - PrismaPg adapter doesn't handle concurrent queries well
  const baseTransactions = await prisma.transaction.findMany({
    include: { createdBy: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 20,
  });
  const total = await prisma.transaction.count();

  if (baseTransactions.length === 0) {
    return { transactions: [] as TransactionWithDetails[], total };
  }

  const txIds = baseTransactions.map((t) => t.id);

  const lines = await prisma.transactionLine.findMany({
    where: { transactionId: { in: txIds } },
    include: { user: true },
  });
  const attachments = await prisma.attachment.findMany({
    where: { transactionId: { in: txIds } },
  });

  // Group related data by transaction ID
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

  const formatted: TransactionWithDetails[] = baseTransactions.map((t) => ({
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
  }));

  return { transactions: formatted, total };
}

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const { transactions, total } = await getTransactions();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-lg font-bold mb-4">Transactions</h1>
      <TransactionList initialTransactions={transactions} initialTotal={total} />
    </div>
  );
}
