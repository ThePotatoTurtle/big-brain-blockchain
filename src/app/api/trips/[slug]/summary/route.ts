import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTripBySlug } from "@/lib/trips";

/**
 * GET /api/trips/[slug]/summary
 *
 * Everything the trip page needs in one fetch:
 * - balances: per-currency net balance per member (isolated from main ledger)
 * - history: per-currency running balances by date (for the chart)
 * - stats: per-currency spending by category, total and per member
 *   (self-entries count here even though they don't move balances)
 * - transferredAt: lock state
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const trip = getTripBySlug(slug);
  if (!trip) {
    return NextResponse.json({ error: "Unknown trip" }, { status: 404 });
  }

  try {
    // Sequential queries (PrismaPg concurrency workaround used elsewhere too)
    const transactions = await prisma.transaction.findMany({
      where: { tripId: slug, status: "confirmed" },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const lines = await prisma.transactionLine.findMany({
      where: { transactionId: { in: transactions.map((t) => t.id) } },
    });
    const meta = await prisma.tripMeta.findUnique({ where: { slug } });

    const linesByTx = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = linesByTx.get(l.transactionId) ?? [];
      arr.push(l);
      linesByTx.set(l.transactionId, arr);
    }

    // --- Balances + history, per currency ---
    const currencies = trip.currencies.map((c) => c.code);
    // running[currency][userId]
    const running: Record<string, Record<number, number>> = {};
    for (const c of currencies) {
      running[c] = {};
      for (const id of trip.memberIds) running[c][id] = 0;
    }
    // history[currency] = [{date, [userId]: balance}]
    const byDate: Record<string, Map<string, Record<number, number>>> = {};
    for (const c of currencies) byDate[c] = new Map();

    for (const t of transactions) {
      const cur = currencies.includes(t.currency) ? t.currency : currencies[0];
      const dateStr = t.date.toISOString().split("T")[0];
      for (const l of linesByTx.get(t.id) ?? []) {
        running[cur][l.userId] = (running[cur][l.userId] ?? 0) + l.amount;
      }
      byDate[cur].set(dateStr, { ...running[cur] });
    }

    const balances = currencies.map((code) => ({
      currency: code,
      users: trip.memberIds.map((id) => ({
        userId: id,
        balance: running[code][id] ?? 0,
      })),
    }));

    const history = currencies.map((code) => ({
      currency: code,
      points: Array.from(byDate[code].entries()).map(([date, bals]) => ({
        date,
        ...Object.fromEntries(
          trip.memberIds.map((id) => [String(id), bals[id] ?? 0])
        ),
      })),
    }));

    // --- Category stats (expenses only; self-entries included via sharesJson) ---
    // stats[currency][category][userId] = gross spending
    const stats: Record<string, Record<string, Record<number, number>>> = {};
    for (const t of transactions) {
      if (t.type !== "expense") continue;
      const cur = currencies.includes(t.currency) ? t.currency : currencies[0];
      const category = t.category ?? "Others";
      const shares =
        (t.sharesJson as { userId: number; amountCents: number }[] | null) ?? [];
      if (shares.length === 0) continue;
      stats[cur] ??= {};
      stats[cur][category] ??= {};
      for (const s of shares) {
        stats[cur][category][s.userId] =
          (stats[cur][category][s.userId] ?? 0) + s.amountCents;
      }
    }

    return NextResponse.json({
      balances,
      history,
      stats,
      transferredAt: meta?.transferredAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Failed to fetch trip summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch trip summary" },
      { status: 500 }
    );
  }
}
