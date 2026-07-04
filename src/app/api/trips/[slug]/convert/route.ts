import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTripBySlug } from "@/lib/trips";
import { sendDiscordNotification } from "@/lib/discord";

/**
 * POST /api/trips/[slug]/convert
 *
 * Converts the trip's current foreign-currency balances (e.g. JPY) into the
 * trip's CAD balance at a user-supplied rate, WITHOUT transferring to the main
 * ledger. Rates are given as foreign units per 1 CAD (CADJPY, e.g. 113.55).
 *
 * For each foreign currency with nonzero balances it creates, inside the trip:
 *   1. a reversal entry in that currency (lines = negated balances) → zeroes it
 *   2. a CAD entry adding the converted amount per user (drift-corrected to
 *      preserve zero-sum)
 *
 * Both are ordinary trip transactions, so per-currency balances/charts recompute
 * automatically. They carry no sharesJson/payersJson, so they're excluded from
 * category stats and are treated as non-editable conversion records in the UI.
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
        { error: `${trip.name} is locked (balances were transferred to the main ledger)` },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      rates?: Record<string, number>;
    };
    const rates = body.rates ?? {};

    // Compute per-currency per-user balances from trip lines
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

    // Which foreign currencies actually have something to convert?
    const foreignToConvert = Object.entries(balances).filter(
      ([cur, byUser]) => cur !== "CAD" && Object.values(byUser).some((v) => v !== 0)
    );
    if (foreignToConvert.length === 0) {
      return NextResponse.json(
        { error: "No foreign balances to convert" },
        { status: 400 }
      );
    }

    // Validate rates and accumulate converted CAD cents per user
    const cadPerUser = new Map<number, number>();
    const rateNotes: string[] = [];
    for (const [cur, byUser] of foreignToConvert) {
      const rate = rates[cur];
      if (!rate || rate <= 0) {
        return NextResponse.json(
          { error: `A positive ${cur} rate is required (${cur} per 1 CAD, e.g. 113.55)` },
          { status: 400 }
        );
      }
      rateNotes.push(`1 CAD = ${rate} ${cur}`);
      const decimals = trip.currencies.find((c) => c.code === cur)?.decimals ?? 2;
      const factor = Math.pow(10, 2 - decimals); // foreign minor units -> CAD cents scaling
      for (const [uidStr, minor] of Object.entries(byUser)) {
        const uid = Number(uidStr);
        const cents = Math.round((minor * factor * 100) / (rate * 100));
        cadPerUser.set(uid, (cadPerUser.get(uid) ?? 0) + cents);
      }
    }

    // Fix FX rounding drift so CAD lines sum to exactly zero
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

    const cadLines = Array.from(cadPerUser.entries())
      .filter(([, v]) => v !== 0)
      .map(([userId, amount]) => ({ userId, amount }));

    // Build each foreign reversal up front so we can validate before writing
    const reversals = foreignToConvert
      .map(([cur, byUser]) => ({
        cur,
        lines: Object.entries(byUser)
          .filter(([, v]) => v !== 0)
          .map(([uidStr, v]) => ({ userId: Number(uidStr), amount: -v })),
      }))
      .filter((r) => r.lines.length > 0);

    // Consistency guard: every entry we write MUST be zero-sum. The CAD side is
    // forced to zero by drift correction; each foreign reversal is only zero if
    // the source balances were themselves balanced. Refuse to write otherwise —
    // this aborts the whole batch (nothing is committed) rather than corrupting
    // the ledger with a non-zero-sum entry.
    const zeroSum = (lines: { amount: number }[]) =>
      lines.reduce((s, l) => s + l.amount, 0) === 0;
    for (const r of reversals) {
      if (!zeroSum(r.lines)) {
        console.error(`Conversion aborted: ${r.cur} balances are not zero-sum`, r.lines);
        return NextResponse.json(
          { error: `Internal error: ${r.cur} balances are not balanced; conversion aborted.` },
          { status: 500 }
        );
      }
    }
    if (!zeroSum(cadLines)) {
      console.error("Conversion aborted: CAD lines are not zero-sum", cadLines);
      return NextResponse.json(
        { error: "Internal error: converted CAD balances do not sum to zero; conversion aborted." },
        { status: 500 }
      );
    }

    const rateNote = rateNotes.join(", ");
    // Shared id linking every transaction created by this conversion, so
    // deleting any one of them removes the whole batch atomically.
    const batchId = `conv_${slug}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await prisma.$transaction(async (tx) => {
      // 1. Reverse each foreign currency's balances (zeroes them)
      for (const { cur, lines: reversalLines } of reversals) {
        await tx.transaction.create({
          data: {
            date: new Date(),
            type: "expense",
            item: `${cur} → CAD conversion @ ${rates[cur]}`,
            notes: `${cur} balances converted to CAD at ${rateNote}`,
            totalAmountCents: reversalLines
              .filter((l) => l.amount > 0)
              .reduce((s, l) => s + l.amount, 0),
            createdById: trip.memberIds[0],
            tripId: slug,
            currency: cur,
            conversionBatchId: batchId,
            lines: { create: reversalLines },
          },
        });
      }

      // 2. Add the converted amount to the trip's CAD balance
      if (cadLines.length > 0) {
        await tx.transaction.create({
          data: {
            date: new Date(),
            type: "expense",
            item: `Converted foreign balances → CAD`,
            notes: `Converted at ${rateNote}`,
            totalAmountCents: cadLines
              .filter((l) => l.amount > 0)
              .reduce((s, l) => s + l.amount, 0),
            createdById: trip.memberIds[0],
            tripId: slug,
            currency: "CAD",
            conversionBatchId: batchId,
            lines: { create: cadLines },
          },
        });
      }
    });

    // One webhook summarizing the whole conversion
    await sendDiscordNotification({
      type: "conversion",
      tripName: trip.name,
      foreignCodes: foreignToConvert.map(([cur]) => cur),
      cadLines: cadLines.map((l) => ({ userId: l.userId, amountCents: l.amount })),
      rateNote,
    }).catch((e) => console.error("Discord conversion notification error:", e));

    return NextResponse.json({ success: true, cadLines });
  } catch (error) {
    console.error("Failed to convert trip balances:", error);
    return NextResponse.json(
      { error: "Failed to convert trip balances" },
      { status: 500 }
    );
  }
}
