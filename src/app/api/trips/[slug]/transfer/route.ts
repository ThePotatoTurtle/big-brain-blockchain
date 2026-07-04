import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTripBySlug } from "@/lib/trips";
import { sendDiscordNotification } from "@/lib/discord";
import type { TripTransferSummary } from "@/lib/types";

/**
 * POST /api/trips/[slug]/transfer
 *
 * Closes a trip: moves its remaining (CAD) balances into the MAIN ledger and
 * locks the trip (read-only). Foreign balances must be converted to CAD FIRST
 * (via /convert) — this route rejects if any nonzero foreign balance remains.
 *
 * Two entries are written atomically:
 *   - a MAIN-ledger entry whose lines are the trip's net CAD balances (this is
 *     what actually transfers the debt), carrying a rich `transferJson` summary.
 *   - a TRIP clearing entry (lines negate the balances) so the trip's own
 *     balances show as cleared, while its history/stats remain intact.
 *
 * Requires `confirmName` to match the trip name (case-insensitive).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const trip = getTripBySlug(slug);
  if (!trip) {
    return NextResponse.json({ error: "Unknown trip" }, { status: 404 });
  }

  try {
    const meta = await prisma.tripMeta.findUnique({ where: { slug } });
    if (meta?.transferredAt) {
      return NextResponse.json(
        { error: `${trip.name} is already locked/transferred` },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      confirmName?: string;
    };

    // Second-layer confirmation: typed trip name (case-insensitive)
    if ((body.confirmName ?? "").trim().toLowerCase() !== trip.name.toLowerCase()) {
      return NextResponse.json(
        { error: "Type the trip name exactly to confirm the transfer" },
        { status: 400 }
      );
    }

    // Load all confirmed trip transactions + lines
    const transactions = await prisma.transaction.findMany({
      where: { tripId: slug, status: "confirmed" },
    });
    const lines = await prisma.transactionLine.findMany({
      where: { transactionId: { in: transactions.map((t) => t.id) } },
    });
    const currencyByTx = new Map(transactions.map((t) => [t.id, t.currency]));

    // Per-currency per-user balances
    const balances: Record<string, Record<number, number>> = {};
    for (const l of lines) {
      const cur = currencyByTx.get(l.transactionId) ?? "CAD";
      balances[cur] ??= {};
      balances[cur][l.userId] = (balances[cur][l.userId] ?? 0) + l.amount;
    }

    // Block transfer while any foreign currency still has a nonzero balance
    const unconverted = Object.entries(balances)
      .filter(([cur, byUser]) => cur !== "CAD" && Object.values(byUser).some((v) => v !== 0))
      .map(([cur]) => cur);
    if (unconverted.length > 0) {
      return NextResponse.json(
        {
          error: `Convert ${unconverted.join("/")} balances to CAD before transferring.`,
        },
        { status: 400 }
      );
    }

    // Net CAD balances per user (foreign already zero)
    const cadPerUser = new Map<number, number>();
    for (const [uidStr, minor] of Object.entries(balances.CAD ?? {})) {
      if (minor !== 0) cadPerUser.set(Number(uidStr), minor);
    }
    const finalLines = Array.from(cadPerUser.entries()).map(([userId, amount]) => ({
      userId,
      amount,
    }));

    // --- Build the rich spending summary (self-entries included via sharesJson) ---
    const currencyTotals: Record<string, number> = {};
    const categoryTotals: Record<string, Record<string, number>> = {};
    const perPerson: Record<string, Record<number, number>> = {};
    for (const t of transactions) {
      if (t.type !== "expense") continue;
      const shares =
        (t.sharesJson as { userId: number; amountCents: number }[] | null) ?? [];
      if (shares.length === 0) continue; // skips conversion/clearing entries
      const cur = t.currency;
      const category = t.category ?? "Others";
      categoryTotals[cur] ??= {};
      perPerson[cur] ??= {};
      for (const s of shares) {
        currencyTotals[cur] = (currencyTotals[cur] ?? 0) + s.amountCents;
        categoryTotals[cur][category] = (categoryTotals[cur][category] ?? 0) + s.amountCents;
        perPerson[cur][s.userId] = (perPerson[cur][s.userId] ?? 0) + s.amountCents;
      }
    }

    const transferredAt = new Date();
    const summary: TripTransferSummary = {
      tripSlug: slug,
      tripName: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      memberIds: trip.memberIds,
      transferredAt: transferredAt.toISOString(),
      transferred: finalLines.map((l) => ({ userId: l.userId, amountCents: l.amount })),
      currencyTotals,
      categoryTotals,
      perPerson,
    };

    // Atomic: main-ledger transfer record + trip clearing entry + lock
    await prisma.$transaction(async (tx) => {
      // Main-ledger entry — this transfers the debt. Always recorded (even if
      // net-zero) so the closure shows on the main transactions list.
      await tx.transaction.create({
        data: {
          date: transferredAt,
          type: "expense",
          item: `Trip Transfer: ${trip.name}`,
          notes: null,
          totalAmountCents: finalLines
            .filter((l) => l.amount > 0)
            .reduce((s, l) => s + l.amount, 0),
          createdById: trip.memberIds[0],
          tripId: null, // main ledger
          currency: "CAD",
          transferJson: summary as unknown as object,
          lines: finalLines.length > 0 ? { create: finalLines } : undefined,
        },
      });

      // Trip clearing entry — zeroes the trip's CAD balance (history/stats stay).
      // Carries the same summary so it renders as the transfer card on the trip
      // page rather than a nonsensical "X paid Y" expense.
      if (finalLines.length > 0) {
        await tx.transaction.create({
          data: {
            date: transferredAt,
            type: "expense",
            item: `Balances transferred to main ledger`,
            notes: null,
            totalAmountCents: finalLines
              .filter((l) => l.amount < 0)
              .reduce((s, l) => s - l.amount, 0),
            createdById: trip.memberIds[0],
            tripId: slug,
            currency: "CAD",
            transferJson: summary as unknown as object,
            lines: { create: finalLines.map((l) => ({ userId: l.userId, amount: -l.amount })) },
          },
        });
      }

      await tx.tripMeta.upsert({
        where: { slug },
        update: { transferredAt },
        create: { slug, transferredAt },
      });
    });

    await sendDiscordNotification({
      type: "transfer",
      tripName: trip.name,
      lines: summary.transferred,
      dateRange: `${trip.startDate} → ${trip.endDate}`,
      currencyTotals,
      categoryTotals,
      perPerson,
    }).catch((e) => console.error("Discord transfer notification error:", e));

    return NextResponse.json({ success: true, lines: finalLines });
  } catch (error) {
    console.error("Failed to transfer trip balances:", error);
    return NextResponse.json(
      { error: "Failed to transfer trip balances" },
      { status: 500 }
    );
  }
}
