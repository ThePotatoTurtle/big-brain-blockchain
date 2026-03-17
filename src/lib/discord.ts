import { getUserById } from "@/lib/users";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

interface ExpenseNotification {
  type: "expense";
  date: string;
  item: string;
  notes: string | null;
  totalAmountCents: number;
  payers: { userId: number; amountCents: number }[];
  shares: { userId: number; amountCents: number }[];
  createdById: number;
}

interface SettlementNotification {
  type: "settlement";
  date: string;
  item: string;
  notes: string | null;
  fromUserId: number;
  toUserId: number;
  amountCents: number;
  createdById: number;
}

type TransactionNotification = ExpenseNotification | SettlementNotification;

function cents(n: number): string {
  const abs = Math.abs(n);
  return `$${(abs / 100).toFixed(2)}`;
}

function buildExpenseEmbed(data: ExpenseNotification) {
  const creator = getUserById(data.createdById)?.name ?? "Someone";

  // Payers line
  const payerLines = data.payers.map((p) => {
    const name = getUserById(p.userId)?.name ?? "?";
    return `${name}: ${cents(p.amountCents)}`;
  });
  const payerStr =
    payerLines.length === 1
      ? payerLines[0].split(":")[0] // just the name if single payer
      : payerLines.join(", ");

  // Shares (who owes what)
  const shareLines = data.shares
    .map((s) => {
      const name = getUserById(s.userId)?.name ?? "?";
      return `${name}: ${cents(s.amountCents)}`;
    })
    .join("\n");

  const fields = [
    { name: "Paid by", value: payerStr, inline: true },
    { name: "Total", value: cents(data.totalAmountCents), inline: true },
    { name: "Date", value: data.date, inline: true },
    { name: "Split", value: shareLines, inline: false },
  ];

  if (data.notes) {
    fields.push({ name: "Notes", value: truncate(data.notes, 500), inline: false });
  }

  return {
    title: `New expense: ${data.item}`,
    color: 0x3b82f6, // blue
    fields,
    footer: { text: `Added by ${creator}` },
    timestamp: new Date().toISOString(),
  };
}

function buildSettlementEmbed(data: SettlementNotification) {
  const from = getUserById(data.fromUserId)?.name ?? "?";
  const to = getUserById(data.toUserId)?.name ?? "?";
  const creator = getUserById(data.createdById)?.name ?? "Someone";

  const fields = [
    { name: "From", value: from, inline: true },
    { name: "To", value: to, inline: true },
    { name: "Amount", value: cents(data.amountCents), inline: true },
    { name: "Date", value: data.date, inline: false },
  ];

  if (data.notes) {
    fields.push({ name: "Notes", value: truncate(data.notes, 500), inline: false });
  }

  return {
    title: `Settlement: ${data.item}`,
    color: 0x10b981, // green
    fields,
    footer: { text: `Added by ${creator}` },
    timestamp: new Date().toISOString(),
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}

export async function sendDiscordNotification(
  data: TransactionNotification
): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  const embed =
    data.type === "expense"
      ? buildExpenseEmbed(data)
      : buildSettlementEmbed(data);

  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Big Brain Blockchain",
      embeds: [embed],
    }),
  });
}
