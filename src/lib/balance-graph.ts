import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getUserById } from "@/lib/users";

/* ------------------------------------------------------------------ *
 * Tunables — edit these directly, no config file needed.
 * ------------------------------------------------------------------ */

/** Transactions at or above this absolute amount get a balance graph. $100. */
export const LARGE_TX_THRESHOLD_CENTS = 10_000;
/** How far back the graph looks from the newest transaction in the DB. */
export const GRAPH_LOOKBACK_MONTHS = 6;
/** Y-axis label increment. $50. */
export const GRAPH_Y_STEP_CENTS = 5_000;
/** Cap on Y labels — the step grows to a multiple of the above if exceeded. */
export const GRAPH_MAX_Y_LABELS = 10;
/** Cap on X-axis date labels, so a long window doesn't get dense. */
export const GRAPH_MAX_X_TICKS = 6;

/* ------------------------------------------------------------------ */

const WIDTH = 920;
const HEIGHT = 460;
const PAD_L = 92;
const PAD_R = 28;
const PAD_T = 58;
const PAD_B = 52;
const PLOT_W = WIDTH - PAD_L - PAD_R;
const PLOT_H = HEIGHT - PAD_T - PAD_B;

// Matches the site's default (Midnight) theme.
const BG = "#0F172A";
const GRID = "#334155";
const AXIS_TEXT = "#94A3B8";
const TITLE_TEXT = "#F1F5F9";
const FONT = "DejaVu Sans, Helvetica, Arial, sans-serif";

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}

/** "$1,250" / "-$50" — axis labels land on whole dollars by construction. */
function axisLabel(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}

/** "$1,234.56" / "-$12.30" — used for the legend's current balance. */
function exactLabel(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface Series {
  userId: number;
  name: string;
  color: string;
  values: number[]; // parallel to `timestamps`
}

/**
 * Renders a balance-history PNG for the given users.
 *
 * Window ends at the newest transaction date in the DB (NOT "today" and not the
 * triggering transaction's date — a backdated entry must not shorten the axis),
 * and starts GRAPH_LOOKBACK_MONTHS earlier. Balances are accumulated from the
 * very first transaction so the window opens at the correct carried-in value.
 *
 * Main ledger only (trip balances are isolated and may be non-CAD).
 * Returns null when there's nothing meaningful to draw.
 */
export async function generateBalanceGraphPng(
  userIds: number[]
): Promise<Buffer | null> {
  const involved = Array.from(new Set(userIds)).filter((id) => getUserById(id));
  if (involved.length === 0) return null;

  // Sequential queries — the PrismaPg adapter is slow with concurrent queries
  const transactions = await prisma.transaction.findMany({
    where: { status: "confirmed", tripId: null },
    select: { id: true, date: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  if (transactions.length === 0) return null;

  const lines = await prisma.transactionLine.findMany({
    where: { transactionId: { in: transactions.map((t) => t.id) } },
    select: { transactionId: true, userId: true, amount: true },
  });
  const linesByTx = new Map<number, typeof lines>();
  for (const l of lines) {
    const arr = linesByTx.get(l.transactionId) ?? [];
    arr.push(l);
    linesByTx.set(l.transactionId, arr);
  }

  // Running balance snapshot per date (last write per date = end-of-day state)
  const running = new Map<number, number>();
  const byDate = new Map<string, Map<number, number>>();
  for (const t of transactions) {
    const d = t.date.toISOString().split("T")[0];
    for (const l of linesByTx.get(t.id) ?? []) {
      running.set(l.userId, (running.get(l.userId) ?? 0) + l.amount);
    }
    byDate.set(d, new Map(running));
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const latestStr = sortedDates[sortedDates.length - 1];
  const latestTs = Date.parse(`${latestStr}T00:00:00Z`);

  const startDate = new Date(latestTs);
  startDate.setUTCMonth(startDate.getUTCMonth() - GRAPH_LOOKBACK_MONTHS);
  const startTs = startDate.getTime();
  const startStr = startDate.toISOString().split("T")[0];

  // Balance carried into the window + every snapshot inside it
  let carry = new Map<number, number>();
  const windowDates: string[] = [];
  for (const d of sortedDates) {
    if (d <= startStr) carry = byDate.get(d)!;
    else windowDates.push(d);
  }
  if (windowDates.length === 0) return null;

  const timestamps = [startTs, ...windowDates.map((d) => Date.parse(`${d}T00:00:00Z`))];
  const series: Series[] = involved.map((id) => {
    const u = getUserById(id)!;
    return {
      userId: id,
      name: u.name,
      color: u.color,
      values: [
        carry.get(id) ?? 0,
        ...windowDates.map((d) => byDate.get(d)!.get(id) ?? 0),
      ],
    };
  });

  // ---- Y domain on GRAPH_Y_STEP_CENTS multiples, always including zero ----
  let lo = 0;
  let hi = 0;
  for (const s of series) {
    for (const v of s.values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  let step = GRAPH_Y_STEP_CENTS;
  const spanForStep = Math.max(hi - lo, 1);
  // Keep labels readable by growing to a multiple of the base step
  const mult = Math.max(1, Math.ceil(spanForStep / (step * (GRAPH_MAX_Y_LABELS - 1))));
  step *= mult;
  let yLo = Math.floor(lo / step) * step;
  let yHi = Math.ceil(hi / step) * step;
  if (yLo === yHi) {
    yLo -= step;
    yHi += step;
  }
  const yTicks: number[] = [];
  for (let v = yLo; v <= yHi; v += step) yTicks.push(v);

  // ---- scales ----
  const tSpan = latestTs - startTs || 1;
  const x = (ts: number) => PAD_L + ((ts - startTs) / tSpan) * PLOT_W;
  const y = (v: number) => PAD_T + ((yHi - v) / (yHi - yLo)) * PLOT_H;

  // ---- X ticks: evenly spaced in TIME so spacing reflects real duration ----
  const xTickCount = Math.min(GRAPH_MAX_X_TICKS, Math.max(2, timestamps.length));
  const xTicks: number[] = [];
  for (let i = 0; i < xTickCount; i++) {
    xTicks.push(startTs + (tSpan * i) / (xTickCount - 1));
  }

  // ---- build SVG ----
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>`,
    `<text x="${PAD_L}" y="26" font-family="${FONT}" font-size="15" font-weight="bold" fill="${TITLE_TEXT}">Balance history — last ${GRAPH_LOOKBACK_MONTHS} months</text>`
  );

  // Legend (name + current balance), laid out left→right under the title
  let lx = PAD_L;
  for (const s of series) {
    const label = `${s.name}  ${exactLabel(s.values[s.values.length - 1])}`;
    parts.push(
      `<circle cx="${lx + 5}" cy="42" r="5" fill="${s.color}"/>`,
      `<text x="${lx + 16}" y="46" font-family="${FONT}" font-size="12" fill="${AXIS_TEXT}">${esc(label)}</text>`
    );
    lx += 26 + label.length * 6.6;
  }

  // Horizontal grid + Y labels
  for (const v of yTicks) {
    const gy = y(v);
    const isZero = v === 0;
    parts.push(
      `<line x1="${PAD_L}" y1="${gy}" x2="${PAD_L + PLOT_W}" y2="${gy}" stroke="${GRID}" stroke-width="${isZero ? 1.5 : 1}"${isZero ? ' stroke-dasharray="6 3"' : ' stroke-dasharray="3 3"'}/>`,
      `<text x="${PAD_L - 10}" y="${gy + 4}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${AXIS_TEXT}">${axisLabel(v)}</text>`
    );
  }

  // X labels
  for (const ts of xTicks) {
    parts.push(
      `<text x="${x(ts)}" y="${PAD_T + PLOT_H + 22}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${AXIS_TEXT}">${fmtDate(ts)}</text>`
    );
  }

  // Series lines
  for (const s of series) {
    const pts = s.values
      .map((v, i) => `${x(timestamps[i]).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
      // Emphasise where each line ends
      `<circle cx="${x(latestTs).toFixed(1)}" cy="${y(s.values[s.values.length - 1]).toFixed(1)}" r="4" fill="${s.color}"/>`
    );
  }

  parts.push("</svg>");

  return sharp(Buffer.from(parts.join(""))).png().toBuffer();
}
