import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { USERS } from "@/lib/users";
import type { Balance } from "@/lib/types";

export async function GET() {
  try {
    // Sum all confirmed MAIN-ledger transaction lines per user (trips are isolated)
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

    // Sort: most negative (deficit) first, most positive (surplus) last
    balances.sort((a, b) => a.balanceCents - b.balanceCents);

    return NextResponse.json(balances);
  } catch (error) {
    console.error("Failed to fetch balances:", error);
    return NextResponse.json(
      { error: "Failed to fetch balances" },
      { status: 500 }
    );
  }
}
