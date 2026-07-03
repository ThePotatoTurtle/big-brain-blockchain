import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { USERS } from "@/lib/users";
import type { BalanceHistoryPoint } from "@/lib/types";

export async function GET() {
  try {
    // Fetch all confirmed MAIN-ledger transactions with lines (trips are isolated)
    const transactions = await prisma.transaction.findMany({
      where: { status: "confirmed", tripId: null },
      include: {
        lines: true,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    // Build running balance per user over time
    const runningBalances: Record<number, number> = {};
    for (const u of USERS) {
      runningBalances[u.id] = 0;
    }

    // Group transactions by date, compute balance after each date
    const historyPoints: BalanceHistoryPoint[] = [];
    let currentDate = "";

    for (const t of transactions) {
      const dateStr = t.date.toISOString().split("T")[0];

      // Apply this transaction's lines to running balances
      for (const line of t.lines) {
        runningBalances[line.userId] =
          (runningBalances[line.userId] ?? 0) + line.amount;
      }

      // If we've moved to a new date, or this is the last transaction of current date
      if (dateStr !== currentDate) {
        currentDate = dateStr;
      }

      // We'll collect all points, then deduplicate to last-per-date below
    }

    // Re-process: emit one point per date (final state after all transactions that day)
    const balancesByDate = new Map<string, Record<number, number>>();
    const dateRunning: Record<number, number> = {};
    for (const u of USERS) {
      dateRunning[u.id] = 0;
    }

    for (const t of transactions) {
      const dateStr = t.date.toISOString().split("T")[0];
      for (const line of t.lines) {
        dateRunning[line.userId] = (dateRunning[line.userId] ?? 0) + line.amount;
      }
      balancesByDate.set(dateStr, { ...dateRunning });
    }

    // Convert to array
    for (const [date, balances] of balancesByDate) {
      const point: BalanceHistoryPoint = { date };
      for (const u of USERS) {
        point[u.name] = balances[u.id] ?? 0;
      }
      historyPoints.push(point);
    }

    return NextResponse.json(historyPoints);
  } catch (error) {
    console.error("Failed to fetch history:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
