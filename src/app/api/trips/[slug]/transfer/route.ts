import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTripBySlug } from "@/lib/trips";
import { sendDiscordNotification } from "@/lib/discord";

/**
 * POST /api/trips/[slug]/transfer
 *
 * Transfers the trip's remaining balances into the MAIN ledger, then locks
 * the trip (read-only). Non-CAD balances are converted using the provided
 * rates: { rates: { JPY: 110 } } meaning 1 CAD = 110 JPY.
 *
 * Creates one main-ledger transaction whose lines mirror the trip balances
 * (zero-sum preserved; rounding drift after FX conversion is absorbed by the
 * member with the largest absolute balance).
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
      rates?: Record<string, number>;
    };
    const rates = body.rates ?? {};

    // Compute per-currency balances from trip lines
    const transactions = await prisma.transaction.findMany({
      where: { tripId: slug, status: "confirmed" },
      select: { id: true, currency: true },
    });
    const lines = await prisma.transactionLine.findMany({
      where: { transactionId: { in: transactions.map((t) => t.id) } },
    });
    const currencyByTx = new Map(transactions.map((t) => [t.id, t.currency]));

    // balances[currency][userId] = minor units
    const balances: Record<string, Record<number, number>> = {};
    for (const l of lines) {
      const cur = currencyByTx.get(l.transactionId) ?? "CAD";
      balances[cur] ??= {};
      balances[cur][l.userId] = (balances[cur][l.userId] ?? 0) + l.amount;
    }

    // Validate rates exist for every non-CAD currency with a nonzero balance
    const rateNotes: string[] = [];
    for (const [cur, byUser] of Object.entries(balances)) {
      if (cur === "CAD") continue;
      const hasNonzero = Object.values(byUser).some((v) => v !== 0);
      if (!hasNonzero) continue;
      const rate = rates[cur];
      if (!rate || rate <= 0) {
        return NextResponse.json(
          { error: `A positive ${cur} rate is required (units of ${cur} per 1 CAD)` },
          { status: 400 }
        );
      }
      rateNotes.push(`1 CAD = ${rate} ${cur}`);
    }

    // Combine into CAD cents per user
    const cadPerUser = new Map<number, number>();
    for (const [cur, byUser] of Object.entries(balances)) {
      for (const [uidStr, minor] of Object.entries(byUser)) {
        const uid = Number(uidStr);
        let cents: number;
        if (cur === "CAD") {
          cents = minor;
        } else {
          const rate = rates[cur];
          if (!rate) continue; // zero-balance currency without rate
          // minor units of foreign currency -> CAD cents
          const factor = Math.pow(10, 2 - (trip.currencies.find((c) => c.code === cur)?.decimals ?? 2));
          cents = Math.round((minor * factor * 100) / (rate * 100));
        }
        cadPerUser.set(uid, (cadPerUser.get(uid) ?? 0) + cents);
      }
    }

    // Fix FX rounding drift so lines sum to exactly zero
    const drift = Array.from(cadPerUser.values()).reduce((s, v) => s + v, 0);
    if (drift !== 0 && cadPerUser.size > 0) {
      let maxUid = -1;
      let maxAbs = -1;
      for (const [uid, v] of cadPerUser) {
        if (Math.abs(v) > maxAbs) {
          maxAbs = Math.abs(v);
          maxUid = uid;
        }
      }
      cadPerUser.set(maxUid, (cadPerUser.get(maxUid) ?? 0) - drift);
    }

    const finalLines = Array.from(cadPerUser.entries())
      .filter(([, v]) => v !== 0)
      .map(([userId, amount]) => ({ userId, amount }));

    const rateNote = rateNotes.length > 0 ? rateNotes.join(", ") : undefined;

    // Create the main-ledger adjustment + lock the trip atomically
    await prisma.$transaction(async (tx) => {
      if (finalLines.length > 0) {
        await tx.transaction.create({
          data: {
            date: new Date(),
            type: "expense",
            item: `${trip.name} — trip balance transfer`,
            notes: rateNote ? `Converted at ${rateNote}` : null,
            totalAmountCents: finalLines
              .filter((l) => l.amount > 0)
              .reduce((s, l) => s + l.amount, 0),
            createdById: trip.memberIds[0],
            tripId: null, // main ledger
            currency: "CAD",
            lines: { create: finalLines },
          },
        });
      }
      await tx.tripMeta.upsert({
        where: { slug },
        update: { transferredAt: new Date() },
        create: { slug, transferredAt: new Date() },
      });
    });

    await sendDiscordNotification({
      type: "transfer",
      tripName: trip.name,
      lines: finalLines.map((l) => ({ userId: l.userId, amountCents: l.amount })),
      rateNote,
    }).catch((e) => console.error("Discord transfer notification error:", e));

    return NextResponse.json({
      success: true,
      lines: finalLines,
    });
  } catch (error) {
    console.error("Failed to transfer trip balances:", error);
    return NextResponse.json(
      { error: "Failed to transfer trip balances" },
      { status: 500 }
    );
  }
}
