import { Resvg } from "@resvg/resvg-js";
import { parse as parseFont } from "opentype.js";
import { prisma } from "@/lib/db";
import { getUserById } from "@/lib/users";
import { NOTO_SANS_TTF } from "@/lib/fonts/noto-sans";

/**
 * Text is converted to vector PATHS rather than emitted as <text>.
 *
 * Renderers resolve <text> through the host's font stack, and serverless hosts
 * ship no fonts — which produced tofu boxes, and then blank labels, in
 * production. resvg-js also has no in-memory font option in v2.6 (only
 * `fontFiles` paths; `fontBuffers` is silently ignored). Baking glyphs into
 * paths removes font resolution from the render step entirely, so labels look
 * identical everywhere regardless of what the host has installed.
 */
const font = parseFont(
  NOTO_SANS_TTF.buffer.slice(
    NOTO_SANS_TTF.byteOffset,
    NOTO_SANS_TTF.byteOffset + NOTO_SANS_TTF.length
  ) as ArrayBuffer
);

type Anchor = "start" | "middle" | "end";

const round2 = (v: number) => Number(v.toFixed(2));

/**
 * Serialise opentype path commands to SVG path data.
 *
 * Deliberately not using opentype's own toPathData(): it emits no `Z`, so every
 * contour stays open, and resvg then silently drops geometry part-way through a
 * long path (this is what truncated labels mid-word). Closing each contour and
 * separating every token fixes it.
 */
function serializeCommands(
  commands: ReturnType<typeof font.getPath>["commands"]
): string {
  const out: (string | number)[] = [];
  let open = false;
  for (const c of commands) {
    switch (c.type) {
      case "M":
        if (open) out.push("Z");
        out.push("M", round2(c.x), round2(c.y));
        open = true;
        break;
      case "L":
        out.push("L", round2(c.x), round2(c.y));
        break;
      case "Q":
        out.push("Q", round2(c.x1), round2(c.y1), round2(c.x), round2(c.y));
        break;
      case "C":
        out.push(
          "C",
          round2(c.x1), round2(c.y1),
          round2(c.x2), round2(c.y2),
          round2(c.x), round2(c.y)
        );
        break;
      case "Z":
        out.push("Z");
        open = false;
        break;
    }
  }
  if (open) out.push("Z");
  return out.join(" ");
}

/** An SVG <path> of `text` drawn at (x, y), y being the text baseline. */
function textPath(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  anchor: Anchor = "start"
): string {
  const width = font.getAdvanceWidth(text, size);
  const tx = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const d = serializeCommands(font.getPath(text, tx, y, size).commands);
  return `<path d="${d}" fill="${fill}"/>`;
}

/** Rendered width of `text`, for laying the legend out without overlaps. */
function textWidth(text: string, size: number): number {
  return font.getAdvanceWidth(text, size);
}

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

// No font-family constant and no XML escaping helper: every label goes through
// textPath() as glyph outlines, so nothing user-facing is ever interpolated
// into markup as text.

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

/** "Jan 28, 2026" — used in the title when the window is re-anchored. */
function fmtDateFull(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** YYYY-MM-DD for a UTC timestamp. */
function toDateStr(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

/** Shift a UTC timestamp by whole months. */
function shiftMonths(ts: number, months: number): number {
  const d = new Date(ts);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
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
 * Window is normally the GRAPH_LOOKBACK_MONTHS ending at the newest transaction
 * date in the DB — NOT "today", so a backdated entry can't shorten the axis.
 *
 * Exception: if `triggerDate` is older than that window, the entry would be
 * invisible off the left edge, so the window re-anchors to start at the entry's
 * own date and run GRAPH_LOOKBACK_MONTHS forward from there (ending before the
 * newest entry).
 *
 * Balances always accumulate from the very first transaction, so the window
 * opens at the correct carried-in value regardless of where it sits.
 *
 * Main ledger only (trip balances are isolated and may be non-CAD).
 * Returns null when there's nothing meaningful to draw.
 */
export async function generateBalanceGraphPng(
  userIds: number[],
  /** Date (YYYY-MM-DD) of the transaction that triggered this graph. */
  triggerDate?: string
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

  // Default window: the GRAPH_LOOKBACK_MONTHS leading up to the newest entry.
  let endTs = latestTs;
  let startTs = shiftMonths(latestTs, -GRAPH_LOOKBACK_MONTHS);
  let reanchored = false;

  // If the triggering entry is older than that window, it would sit off the
  // left edge and be invisible. Re-anchor instead: start AT the entry's date
  // and run forward. Because the trigger predates (latest - lookback), the new
  // end is always before the newest entry — the usual "axis ends at the latest
  // entry" rule is deliberately dropped here so the entry is actually shown.
  if (triggerDate) {
    const triggerTs = Date.parse(`${triggerDate}T00:00:00Z`);
    if (!Number.isNaN(triggerTs) && triggerTs < startTs) {
      startTs = triggerTs;
      endTs = shiftMonths(triggerTs, GRAPH_LOOKBACK_MONTHS);
      reanchored = true;
    }
  }

  const startStr = toDateStr(startTs);
  const endStr = toDateStr(endTs);

  // Balance carried into the window + every snapshot inside it
  let carry = new Map<number, number>();
  const windowDates: string[] = [];
  for (const d of sortedDates) {
    if (d <= startStr) carry = byDate.get(d)!;
    else if (d <= endStr) windowDates.push(d);
  }

  // Always anchor the series to both edges so lines span the full axis, even
  // when nothing happened inside the window.
  const lastSnapshot = windowDates.length
    ? byDate.get(windowDates[windowDates.length - 1])!
    : carry;
  const timestamps = [
    startTs,
    ...windowDates.map((d) => Date.parse(`${d}T00:00:00Z`)),
    endTs,
  ];
  const series: Series[] = involved.map((id) => {
    const u = getUserById(id)!;
    return {
      userId: id,
      name: u.name,
      color: u.color,
      values: [
        carry.get(id) ?? 0,
        ...windowDates.map((d) => byDate.get(d)!.get(id) ?? 0),
        lastSnapshot.get(id) ?? 0, // hold the final balance out to the right edge
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
  const tSpan = endTs - startTs || 1;
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
    // ASCII only — the embedded font is a latin subset (no em dash).
    // Say so explicitly when re-anchored: the window no longer ends at the
    // newest entry, so "last N months" would be wrong.
    textPath(
      reanchored
        ? `Balance history - ${GRAPH_LOOKBACK_MONTHS} months from ${fmtDateFull(startTs)}`
        : `Balance history - last ${GRAPH_LOOKBACK_MONTHS} months`,
      PAD_L,
      26,
      15,
      TITLE_TEXT
    )
  );

  // Legend (name + current balance), laid out left→right under the title.
  // Advance by measured glyph width so entries can't overlap.
  let lx = PAD_L;
  for (const s of series) {
    const label = `${s.name}  ${exactLabel(s.values[s.values.length - 1])}`;
    parts.push(
      `<circle cx="${lx + 5}" cy="42" r="5" fill="${s.color}"/>`,
      textPath(label, lx + 16, 46, 12, AXIS_TEXT)
    );
    lx += 30 + textWidth(label, 12);
  }

  // Horizontal grid + Y labels
  for (const v of yTicks) {
    const gy = y(v);
    const isZero = v === 0;
    parts.push(
      `<line x1="${PAD_L}" y1="${gy}" x2="${PAD_L + PLOT_W}" y2="${gy}" stroke="${GRID}" stroke-width="${isZero ? 1.5 : 1}"${isZero ? ' stroke-dasharray="6 3"' : ' stroke-dasharray="3 3"'}/>`,
      textPath(axisLabel(v), PAD_L - 10, gy + 4, 12, AXIS_TEXT, "end")
    );
  }

  // X labels
  for (const ts of xTicks) {
    parts.push(
      textPath(fmtDate(ts), x(ts), PAD_T + PLOT_H + 22, 12, AXIS_TEXT, "middle")
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
      `<circle cx="${x(endTs).toFixed(1)}" cy="${y(s.values[s.values.length - 1]).toFixed(1)}" r="4" fill="${s.color}"/>`
    );
  }

  parts.push("</svg>");

  // No font config needed — every label is already a <path>, so the renderer
  // never has to resolve a typeface.
  return Buffer.from(new Resvg(parts.join("")).render().asPng());
}
