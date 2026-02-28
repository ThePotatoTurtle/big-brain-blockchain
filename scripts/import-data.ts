import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import * as XLSX from "xlsx";
import * as path from "path";

const connectionString =
  process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString: connectionString! });
const prisma = new PrismaClient({ adapter });

// User name -> DB id mapping (alphabetical seed order)
const USER_ID: Record<string, number> = {
  Andy: 1,
  Calvin: 2,
  Danny: 3,
  Henry: 4,
  Jayden: 5,
  Leon: 6,
  Timmy: 7,
};

function parseDDMMYYYY(s: string): string {
  // "18/02/2023" -> "2023-02-18"
  const [d, m, y] = s.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function excelSerialToISO(serial: number): string {
  const parsed = XLSX.SSF.parse_date_code(serial);
  return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
}

function dollarsToCents(dollars: number | string): number {
  const n = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

async function importTransactions() {
  const filePath = path.join(process.cwd(), "transactions.xlsx");
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  // Skip header row
  let created = 0;
  let errors = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as (string | number | null)[];
    if (!row || !row[0]) continue;

    const dateStr = parseDDMMYYYY(String(row[0]));
    const item = String(row[1] || "");
    const notes = row[2] ? String(row[2]) : null;
    const paidByName = String(row[3]);
    const totalFromSheet = dollarsToCents(row[4] as number | string);
    const splitsStr = String(row[5] || "");

    const payerId = USER_ID[paidByName];
    if (!payerId) {
      console.error(`Row ${i}: Unknown payer "${paidByName}"`);
      errors++;
      continue;
    }

    // Parse splits: "Danny:17.50,Timmy:17.50,Jayden:17.50,Calvin:17.50"
    const splitPairs = splitsStr.split(",").map((s) => s.trim()).filter(Boolean);
    const splits: { userId: number; amountCents: number }[] = [];
    let sumSplitsCents = 0;

    for (const pair of splitPairs) {
      const colonIdx = pair.indexOf(":");
      if (colonIdx < 0) {
        console.error(`Row ${i}: Bad split format "${pair}"`);
        continue;
      }
      const name = pair.substring(0, colonIdx).trim();
      const amt = pair.substring(colonIdx + 1).trim();
      const userId = USER_ID[name];
      if (!userId) {
        console.error(`Row ${i}: Unknown user in split "${name}"`);
        continue;
      }
      const cents = dollarsToCents(amt);
      splits.push({ userId, amountCents: cents });
      sumSplitsCents += cents;
    }

    if (splits.length === 0) {
      console.error(`Row ${i}: No valid splits`);
      errors++;
      continue;
    }

    // Build transaction lines (zero-sum):
    // Payer gets +sumSplitsCents credit, each person gets -theirShare debit
    // If payer is also in splits, merge into one line
    const lineMap = new Map<number, number>();

    // Payer credit
    lineMap.set(payerId, sumSplitsCents);

    // Debits for each split person
    for (const { userId, amountCents } of splits) {
      const current = lineMap.get(userId) || 0;
      lineMap.set(userId, current - amountCents);
    }

    // Remove zero lines
    const lines = Array.from(lineMap.entries())
      .filter(([, amt]) => amt !== 0)
      .map(([userId, amount]) => ({ userId, amount }));

    // Verify zero-sum
    const lineSum = lines.reduce((s, l) => s + l.amount, 0);
    if (lineSum !== 0) {
      console.error(`Row ${i}: Lines don't sum to zero (${lineSum}) - "${item}"`);
      errors++;
      continue;
    }

    try {
      await prisma.transaction.create({
        data: {
          date: new Date(dateStr + "T00:00:00Z"),
          type: "expense",
          item,
          notes,
          totalAmountCents: sumSplitsCents, // actual total from splits
          createdById: payerId,
          status: "confirmed",
          lines: {
            create: lines,
          },
        },
      });
      created++;
      if (created % 20 === 0) console.log(`  ...${created} transactions created`);
    } catch (err) {
      console.error(`Row ${i}: DB error for "${item}":`, err);
      errors++;
    }
  }

  console.log(`Transactions: ${created} created, ${errors} errors`);
}

async function importSettlements() {
  const filePath = path.join(process.cwd(), "settlements.xlsx");
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  let created = 0;
  let errors = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as (string | number | null)[];
    if (!row || !row[0]) continue;

    // Date could be Excel serial or string
    let dateStr: string;
    if (typeof row[0] === "number") {
      dateStr = excelSerialToISO(row[0]);
    } else {
      dateStr = parseDDMMYYYY(String(row[0]));
    }

    const item = String(row[1] || "Settlement");
    const notes = row[2] && String(row[2]) !== "/" ? String(row[2]) : null;
    const fromName = String(row[3]);
    const toName = String(row[4]);
    const totalCents = dollarsToCents(row[5] as number | string);

    const fromId = USER_ID[fromName];
    const toId = USER_ID[toName];

    if (!fromId) {
      console.error(`Settlement row ${i}: Unknown from "${fromName}"`);
      errors++;
      continue;
    }
    if (!toId) {
      console.error(`Settlement row ${i}: Unknown to "${toName}"`);
      errors++;
      continue;
    }

    // Settlement: from (paid IRL) gets +amount, to (received) gets -amount
    try {
      await prisma.transaction.create({
        data: {
          date: new Date(dateStr + "T00:00:00Z"),
          type: "settlement",
          item,
          notes,
          totalAmountCents: totalCents,
          createdById: fromId,
          status: "confirmed",
          lines: {
            create: [
              { userId: fromId, amount: totalCents },
              { userId: toId, amount: -totalCents },
            ],
          },
        },
      });
      created++;
    } catch (err) {
      console.error(`Settlement row ${i}: DB error:`, err);
      errors++;
    }
  }

  console.log(`Settlements: ${created} created, ${errors} errors`);
}

async function main() {
  console.log("Starting import...\n");

  // Verify users exist
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  console.log("Users in DB:", users.map((u) => `${u.id}=${u.name}`).join(", "));

  // Verify user ID mapping
  for (const u of users) {
    if (USER_ID[u.name] !== u.id) {
      console.error(`USER ID MISMATCH: ${u.name} expected ${USER_ID[u.name]} got ${u.id}`);
      process.exit(1);
    }
  }
  console.log("User ID mapping verified!\n");

  // Check existing transactions
  const existingCount = await prisma.transaction.count();
  if (existingCount > 0) {
    console.error(`WARNING: ${existingCount} transactions already exist! Clear DB first.`);
    process.exit(1);
  }

  console.log("Importing transactions...");
  await importTransactions();

  console.log("\nImporting settlements...");
  await importSettlements();

  // Print final balance summary
  console.log("\n--- Final Balances ---");
  const balances = await prisma.transactionLine.groupBy({
    by: ["userId"],
    _sum: { amount: true },
  });
  for (const b of balances) {
    const user = users.find((u) => u.id === b.userId);
    const cents = b._sum.amount || 0;
    const dollars = (cents / 100).toFixed(2);
    console.log(`  ${user?.name}: ${cents >= 0 ? "+" : ""}$${dollars}`);
  }

  console.log("\nImport complete!");
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
