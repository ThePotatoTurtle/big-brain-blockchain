import { getUserById } from "@/lib/users";

/** Optional trip context shared by all notification types. */
interface TripContext {
  tripName?: string; // shown as a [Trip Name] title prefix
  currency?: string; // "JPY" formats as ¥ whole yen; default CAD dollars
}

interface ExpenseNotification extends TripContext {
  type: "expense";
  date: string;
  item: string;
  notes: string | null;
  totalAmountCents: number;
  payers: { userId: number; amountCents: number }[];
  shares: { userId: number; amountCents: number }[];
  createdById: number;
  imageUrls?: string[];
}

interface SettlementNotification extends TripContext {
  type: "settlement";
  date: string;
  item: string;
  notes: string | null;
  fromUserId: number;
  toUserId: number;
  amountCents: number;
  createdById: number;
  imageUrls?: string[];
}

interface DeletionNotification extends TripContext {
  type: "deletion";
  item: string;
  transactionType: "expense" | "settlement";
  totalAmountCents: number | null;
  date: string;
}

interface TransferNotification extends TripContext {
  type: "transfer";
  tripName: string;
  /** Final main-ledger adjustment per user, in CAD cents. */
  lines: { userId: number; amountCents: number }[];
  /** Rate used to convert leftover non-CAD balances, if any (e.g. "1 CAD = 110 JPY"). */
  rateNote?: string;
}

interface EditedExpenseNotification extends TripContext {
  type: "edited_expense";
  date: string;
  item: string;
  notes: string | null;
  totalAmountCents: number;
  payers: { userId: number; amountCents: number }[];
  shares: { userId: number; amountCents: number }[];
  createdById: number;
  imageUrls?: string[];
}

interface EditedSettlementNotification extends TripContext {
  type: "edited_settlement";
  date: string;
  item: string;
  notes: string | null;
  fromUserId: number;
  toUserId: number;
  amountCents: number;
  createdById: number;
  imageUrls?: string[];
}

type TransactionNotification =
  | ExpenseNotification
  | SettlementNotification
  | DeletionNotification
  | EditedExpenseNotification
  | EditedSettlementNotification
  | TransferNotification;

interface DiscordEmbed {
  title: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  timestamp: string;
  url?: string;
  image?: { url: string };
}

/** Format minor units for the given currency (JPY = whole yen, default = dollars). */
function money(n: number, currency?: string): string {
  const abs = Math.abs(n);
  if (currency === "JPY") return `¥${abs.toLocaleString("en-US")}`;
  return `$${(abs / 100).toFixed(2)}`;
}

/** Prefix embed titles with the trip name when present. */
function withTrip(title: string, tripName?: string): string {
  return tripName ? `[${tripName}] ${title}` : title;
}

function buildExpenseEmbed(data: ExpenseNotification): DiscordEmbed {
  // Payers line
  const payerLines = data.payers.map((p) => {
    const name = getUserById(p.userId)?.name ?? "?";
    return `${name}: ${money(p.amountCents, data.currency)}`;
  });
  const payerStr =
    payerLines.length === 1
      ? payerLines[0].split(":")[0] // just the name if single payer
      : payerLines.join(", ");

  // Shares (who owes what)
  const shareLines = data.shares
    .map((s) => {
      const name = getUserById(s.userId)?.name ?? "?";
      return `${name}: ${money(s.amountCents, data.currency)}`;
    })
    .join("\n");

  const fields = [
    { name: "Paid by", value: payerStr, inline: true },
    { name: "Total", value: money(data.totalAmountCents, data.currency), inline: true },
    { name: "Date", value: data.date, inline: true },
    { name: "Split", value: shareLines, inline: false },
  ];

  if (data.notes) {
    fields.push({ name: "Notes", value: truncate(data.notes, 500), inline: false });
  }

  return {
    title: withTrip(`New expense: ${data.item}`, data.tripName),
    color: 0x3b82f6, // blue
    fields,
    timestamp: new Date().toISOString(),
  };
}

function buildSettlementEmbed(data: SettlementNotification): DiscordEmbed {
  const from = getUserById(data.fromUserId)?.name ?? "?";
  const to = getUserById(data.toUserId)?.name ?? "?";

  const fields = [
    { name: "From", value: from, inline: true },
    { name: "To", value: to, inline: true },
    { name: "Amount", value: money(data.amountCents, data.currency), inline: true },
    { name: "Date", value: data.date, inline: false },
  ];

  if (data.notes) {
    fields.push({ name: "Notes", value: truncate(data.notes, 500), inline: false });
  }

  return {
    title: withTrip(`Settlement: ${data.item}`, data.tripName),
    color: 0x10b981, // green
    fields,
    timestamp: new Date().toISOString(),
  };
}

function buildDeletionEmbed(data: DeletionNotification): DiscordEmbed {
  const typeLabel = data.transactionType === "settlement" ? "Settlement" : "Expense";
  const fields = [
    { name: "Type", value: typeLabel, inline: true },
    { name: "Date", value: data.date, inline: true },
  ];
  if (data.totalAmountCents != null) {
    fields.push({ name: "Amount", value: money(data.totalAmountCents, data.currency), inline: true });
  }

  return {
    title: withTrip(`Deleted: ${data.item}`, data.tripName),
    color: 0xef4444, // red
    fields,
    timestamp: new Date().toISOString(),
  };
}

function buildTransferEmbed(data: TransferNotification): DiscordEmbed {
  const lineStr =
    data.lines.length > 0
      ? data.lines
          .map((l) => {
            const name = getUserById(l.userId)?.name ?? "?";
            const sign = l.amountCents > 0 ? "+" : "";
            return `${name}: ${sign}${money(l.amountCents)}`;
          })
          .join("\n")
      : "All balances were already settled — nothing to transfer.";

  const fields = [
    { name: "Applied to main balances", value: lineStr, inline: false },
  ];
  if (data.rateNote) {
    fields.push({ name: "Conversion", value: data.rateNote, inline: false });
  }

  return {
    title: `Trip closed: ${data.tripName} — balances transferred to main ledger`,
    color: 0x8b5cf6, // violet
    fields,
    timestamp: new Date().toISOString(),
  };
}

function buildEditedExpenseEmbed(data: EditedExpenseNotification) {
  const embed = buildExpenseEmbed({ ...data, type: "expense" });
  embed.title = withTrip(`Edited: ${data.item}`, data.tripName);
  embed.color = 0xf59e0b; // amber
  return embed;
}

function buildEditedSettlementEmbed(data: EditedSettlementNotification) {
  const embed = buildSettlementEmbed({ ...data, type: "settlement" });
  embed.title = withTrip(`Edited: ${data.item}`, data.tripName);
  embed.color = 0xf59e0b; // amber
  return embed;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}

export async function sendDiscordNotification(
  data: TransactionNotification
): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("DISCORD_WEBHOOK_URL not set, skipping notification");
    return;
  }

  const embed =
    data.type === "deletion"
      ? buildDeletionEmbed(data)
      : data.type === "transfer"
        ? buildTransferEmbed(data)
        : data.type === "edited_expense"
          ? buildEditedExpenseEmbed(data)
          : data.type === "edited_settlement"
            ? buildEditedSettlementEmbed(data)
            : data.type === "expense"
              ? buildExpenseEmbed(data)
              : buildSettlementEmbed(data);

  const embeds: DiscordEmbed[] = [embed];

  // Attach photos. One image goes straight on the main embed. For several,
  // Discord merges multiple embeds that share one `url` into a single gallery.
  const imageUrls = ("imageUrls" in data ? data.imageUrls : undefined) ?? [];
  if (imageUrls.length === 1) {
    embed.image = { url: imageUrls[0] };
  } else if (imageUrls.length > 1) {
    const galleryUrl = imageUrls[0];
    embed.url = galleryUrl;
    embed.image = { url: imageUrls[0] };
    for (let i = 1; i < imageUrls.length && embeds.length < 4; i++) {
      embeds.push({
        title: "",
        color: embed.color,
        fields: [],
        timestamp: embed.timestamp,
        url: galleryUrl,
        image: { url: imageUrls[i] },
      });
    }
  }

  const payload = JSON.stringify({
    username: "Big Brain Blockchain",
    embeds,
  });

  // Retry up to 3 times (transient TLS/network errors are common)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`Discord webhook failed (${res.status}):`, text);
      }
      return; // success or non-retryable error
    } catch (err) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw err; // give up after 3 attempts
    }
  }
}
