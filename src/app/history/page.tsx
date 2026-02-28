import { prisma } from "@/lib/db";
import { USERS } from "@/lib/users";
import type { BalanceHistoryPoint } from "@/lib/types";
import BalanceChart from "@/components/BalanceChart";

async function getHistoryData(): Promise<BalanceHistoryPoint[]> {
  const transactions = await prisma.transaction.findMany({
    where: { status: "confirmed" },
    include: { lines: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const dateRunning: Record<number, number> = {};
  for (const u of USERS) {
    dateRunning[u.id] = 0;
  }

  const balancesByDate = new Map<string, Record<number, number>>();

  for (const t of transactions) {
    const dateStr = t.date.toISOString().split("T")[0];
    for (const line of t.lines) {
      dateRunning[line.userId] = (dateRunning[line.userId] ?? 0) + line.amount;
    }
    balancesByDate.set(dateStr, { ...dateRunning });
  }

  const points: BalanceHistoryPoint[] = [];
  for (const [date, balances] of balancesByDate) {
    const point: BalanceHistoryPoint = { date };
    for (const u of USERS) {
      point[u.name] = balances[u.id] ?? 0;
    }
    points.push(point);
  }

  return points;
}

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const data = await getHistoryData();

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-lg font-bold mb-4">Balance History</h1>
      <BalanceChart data={data} />
    </div>
  );
}
