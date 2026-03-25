import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { USERS, getUserById } from "@/lib/users";
import {
  computeExpenseLines,
  computeSettlementLines,
  validateZeroSum,
} from "@/lib/transactions";
import { sendExpenseNotifications } from "@/lib/email";
import { sendDiscordNotification } from "@/lib/discord";
import type {
  CreateTransactionRequest,
  TransactionWithDetails,
  TransactionLineDetail,
} from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const skip = (page - 1) * limit;

  try {
    // Workaround: Prisma 7 PrismaPg adapter is extremely slow with concurrent queries
    // and multiple includes. Query sequentially and merge in application code.
    const baseTransactions = await prisma.transaction.findMany({
      include: { createdBy: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    });
    const total = await prisma.transaction.count();

    let formatted: TransactionWithDetails[] = [];
    if (baseTransactions.length > 0) {
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

      formatted = baseTransactions.map((t) => ({
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
    }

    return NextResponse.json({
      transactions: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Failed to fetch transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Missing transaction id" }, { status: 400 });
    }

    // Fetch transaction details before deleting (for discord notification)
    const transaction = await prisma.transaction.findUnique({ where: { id } });
    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Delete — cascade removes lines and attachments automatically
    await prisma.transaction.delete({ where: { id } });

    // Send discord notification
    await sendDiscordNotification({
      type: "deletion",
      item: transaction.item,
      transactionType: transaction.type as "expense" | "settlement",
      totalAmountCents: transaction.totalAmountCents,
      date: transaction.date.toISOString().split("T")[0],
    }).catch((e) => console.error("Discord deletion notification error:", e));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete transaction:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTransactionRequest = await request.json();

    let lines;
    let item = body.item;

    if (body.type === "expense") {
      // Validate shares sum matches total
      const sharesSum = body.shares.reduce((s, sh) => s + sh.amountCents, 0);
      if (sharesSum !== body.totalAmountCents) {
        return NextResponse.json(
          {
            error: `Shares sum (${sharesSum}) does not match total (${body.totalAmountCents})`,
          },
          { status: 400 }
        );
      }

      // Validate payers sum matches total
      const payersSum = body.payers.reduce((s, p) => s + p.amountCents, 0);
      if (payersSum !== body.totalAmountCents) {
        return NextResponse.json(
          {
            error: `Payers sum (${payersSum}) does not match total (${body.totalAmountCents})`,
          },
          { status: 400 }
        );
      }

      // Validate each payer has a positive amount
      for (const p of body.payers) {
        if (p.amountCents <= 0) {
          return NextResponse.json(
            { error: "Each payer must have a positive amount" },
            { status: 400 }
          );
        }
      }

      lines = computeExpenseLines(body.payers, body.shares);
    } else if (body.type === "settlement") {
      if (body.fromUserId === body.toUserId) {
        return NextResponse.json(
          { error: "From and To users must be different" },
          { status: 400 }
        );
      }

      lines = computeSettlementLines(
        body.fromUserId,
        body.toUserId,
        body.amountCents
      );

      // Auto-generate item name for settlements if generic
      if (!item || item === "Settlement") {
        const from = getUserById(body.fromUserId);
        const to = getUserById(body.toUserId);
        item = `${from?.name ?? "?"} paid ${to?.name ?? "?"}`;
      }
    } else {
      return NextResponse.json(
        { error: "Invalid transaction type" },
        { status: 400 }
      );
    }

    // Defensive: verify zero-sum
    if (!validateZeroSum(lines)) {
      console.error("Zero-sum validation failed:", lines);
      return NextResponse.json(
        { error: "Internal error: transaction lines do not sum to zero" },
        { status: 500 }
      );
    }

    // Create transaction atomically
    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          date: new Date(body.date + "T00:00:00Z"),
          type: body.type,
          item,
          notes: body.notes ?? null,
          totalAmountCents:
            body.type === "expense" ? body.totalAmountCents : body.amountCents,
          createdById: body.createdById,
          lines: {
            create: lines.map((l) => ({
              userId: l.userId,
              amount: l.amount,
            })),
          },
          attachments: body.attachmentUrls
            ? {
                create: body.attachmentUrls.map((a) => ({
                  fileUrl: a.fileUrl,
                  fileName: a.fileName,
                })),
              }
            : undefined,
        },
      });

      // Fetch lines separately (workaround for Prisma 7 multi-include bug)
      const createdLines = await tx.transactionLine.findMany({
        where: { transactionId: created.id },
        include: { user: true },
      });

      return { ...created, lines: createdLines };
    });

    // Send notifications (must await — Vercel freezes the function after response)
    const notifications: Promise<unknown>[] = [];

    if (body.type === "expense") {
      const balanceResults = await prisma.transactionLine.groupBy({
        by: ["userId"],
        _sum: { amount: true },
        where: { transaction: { status: "confirmed" } },
      });
      const balanceMap = new Map<number, number>();
      for (const r of balanceResults) {
        balanceMap.set(r.userId, r._sum.amount ?? 0);
      }

      const chargedUsers = transaction.lines
        .filter((l) => l.amount < 0)
        .map((l) => {
          const userInfo = getUserById(l.userId);
          return {
            userId: l.userId,
            name: l.user.name,
            email: userInfo?.email ?? null,
            amountCents: l.amount,
            balanceCents: balanceMap.get(l.userId) ?? 0,
          };
        });

      const creatorName = getUserById(body.createdById)?.name ?? "Someone";
      notifications.push(
        sendExpenseNotifications(creatorName, item, chargedUsers).catch((e) =>
          console.error("Email notification error:", e)
        )
      );
    }

    if (body.type === "expense") {
      notifications.push(
        sendDiscordNotification({
          type: "expense",
          date: body.date,
          item,
          notes: body.notes ?? null,
          totalAmountCents: body.totalAmountCents,
          payers: body.payers,
          shares: body.shares,
          createdById: body.createdById,
        }).catch((e) => console.error("Discord notification error:", e))
      );
    } else if (body.type === "settlement") {
      notifications.push(
        sendDiscordNotification({
          type: "settlement",
          date: body.date,
          item,
          notes: body.notes ?? null,
          fromUserId: body.fromUserId,
          toUserId: body.toUserId,
          amountCents: body.amountCents,
          createdById: body.createdById,
        }).catch((e) => console.error("Discord notification error:", e))
      );
    }

    await Promise.allSettled(notifications);

    return NextResponse.json({ id: transaction.id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create transaction:", error);
    return NextResponse.json(
      { error: "Failed to create transaction" },
      { status: 500 }
    );
  }
}
