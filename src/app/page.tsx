import { prisma } from "@/lib/db";
import { USERS } from "@/lib/users";
import type { Balance } from "@/lib/types";
import BalanceDisplay from "@/components/BalanceDisplay";
import TransactionForm from "@/components/TransactionForm";

async function getBalances(): Promise<Balance[]> {
  const results = await prisma.transactionLine.groupBy({
    by: ["userId"],
    _sum: { amount: true },
    where: {
      transaction: { status: "confirmed", tripId: null },
    },
  });

  const balanceMap = new Map<number, number>();
  for (const r of results) {
    balanceMap.set(r.userId, r._sum.amount ?? 0);
  }

  const balances: Balance[] = USERS.map((u) => ({
    userId: u.id,
    name: u.name,
    balanceCents: balanceMap.get(u.id) ?? 0,
    color: u.color,
  }));

  balances.sort((a, b) => a.balanceCents - b.balanceCents);
  return balances;
}

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const balances = await getBalances();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <BalanceDisplay balances={balances} />
      <TransactionForm />
    </div>
  );
}
