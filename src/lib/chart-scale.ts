/**
 * Shared Y-axis scaling for the balance charts.
 *
 * A balance ledger has a wide dynamic range: after a trip transfer one person
 * can sit at +$5,700 while four others are inside ±$400, which squashes the
 * small balances into a few pixels on a linear axis.
 *
 * `symlog` (symmetric log) fixes that. It is logarithmic in the tails but
 * LINEAR within ±constant, which matters here specifically — balances cross
 * zero every time somebody settles up, and a pure log (or a signed cube root,
 * which has infinite slope at zero) would make ±$2 of noise look violent.
 *
 * Both modes put ticks on a 1 / 2.5 / 5 ladder so the axis never renders the
 * ~90 gridlines a fixed $100 step produced across a $9,000 span.
 */
import { scaleSymlog } from "d3-scale";

export type AxisScale = "linear" | "log";

/** Tick mantissas, densest first — we thin the ladder when it gets crowded. */
const LADDERS: readonly number[][] = [
  [1, 2.5, 5],
  [1, 5],
  [1],
];

/** Default symlog linear-threshold for CAD charts: $50, in cents. */
export const DEFAULT_SYMLOG_CONSTANT = 5000;

const TARGET_LINEAR_TICKS = 8;
const MAX_SYMLOG_TICKS = 15;
/** Below this many ladder ticks the axis looks empty; fall back to even ticks. */
const MIN_SYMLOG_TICKS = 4;
/**
 * Domain padding, in symlog-transformed units. At the tails symlog is
 * logarithmic, so this is multiplicative: 0.15 is ~16% headroom past the
 * extreme value, which keeps the outermost line (and its hover dot) clear of
 * the plot edge. Percentage-of-span padding would balloon to 40%+ here.
 */
const SYMLOG_PAD = 0.15;

const sign = (x: number) => (x < 0 ? -1 : 1);

/**
 * symlog forward transform, matching d3's scaleSymlog.
 *
 * Exported because the Discord PNG in balance-graph.ts hand-rolls its SVG and
 * cannot use a d3 scale object — it needs the bare transform so both surfaces
 * position values identically.
 */
export const symlogT = (x: number, c: number) =>
  sign(x) * Math.log1p(Math.abs(x) / c);
/** symlog inverse. */
const symlogInv = (y: number, c: number) => sign(y) * Math.expm1(Math.abs(y)) * c;

/**
 * A d3 symlog scale for Recharts' `scale` prop. Recharts copies it and applies
 * the domain/range itself, so we only set the constant here.
 */
export function makeSymlogScale(constant: number) {
  return scaleSymlog().constant(constant);
}

/** All ladder values (mantissa x 10^n) within [lo, hi], ascending. */
function ladderValues(lo: number, hi: number, mantissas: number[]): number[] {
  if (hi <= 0) return [];
  const out: number[] = [];
  const startExp = Math.floor(Math.log10(Math.max(lo, 1e-9)));
  const endExp = Math.ceil(Math.log10(hi));
  for (let e = startExp; e <= endExp; e++) {
    for (const m of mantissas) {
      const v = m * Math.pow(10, e);
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out.sort((a, b) => a - b);
}

export interface AxisConfig {
  domain: [number, number];
  ticks: number[];
}

/**
 * Linear axis: a "nice" step near TARGET_LINEAR_TICKS, domain rounded outward
 * to whole steps. Zero always lands on a tick because the bounds are multiples
 * of the step.
 */
export function linearAxis(dataMin: number, dataMax: number): AxisConfig {
  let lo = Math.min(0, dataMin);
  let hi = Math.max(0, dataMax);
  if (lo === hi) {
    // Everything settled to zero — show a small symmetric window rather than
    // a degenerate axis labelled in single cents.
    lo -= 100;
    hi += 100;
  }

  const raw = (hi - lo) / TARGET_LINEAR_TICKS;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, Math.round(mag * mult));

  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(Math.round(v));

  return { domain: [first, last], ticks };
}

/**
 * Symlog axis: domain padded in *transformed* space (so the padding looks even
 * at both ends), ticks on the ladder between the constant and the extremes.
 * Values inside ±constant get no ticks of their own — that band is linear and
 * visually small, and crowding it just produces unreadable labels.
 */
export function symlogAxis(
  dataMin: number,
  dataMax: number,
  constant: number,
  maxTicks: number = MAX_SYMLOG_TICKS
): AxisConfig {
  const lo = Math.min(0, dataMin);
  const hi = Math.max(0, dataMax);

  const tLo = symlogT(lo, constant);
  const tHi = symlogT(hi, constant);
  const domain: [number, number] = [
    Math.floor(symlogInv(tLo - SYMLOG_PAD, constant)),
    Math.ceil(symlogInv(tHi + SYMLOG_PAD, constant)),
  ];

  const maxPos = Math.abs(domain[1]);
  const maxNeg = Math.abs(domain[0]);

  let ticks: number[] = [];
  for (const mantissas of LADDERS) {
    const pos = ladderValues(constant, maxPos, mantissas);
    const neg = ladderValues(constant, maxNeg, mantissas).map((v) => -v);
    ticks = [...neg.reverse(), 0, ...pos];
    if (ticks.length <= maxTicks) break;
  }

  if (ticks.length < MIN_SYMLOG_TICKS) {
    // The data barely leaves the ±constant band, where symlog IS linear, so
    // ladder ticks would leave the axis nearly bare. Even ticks are both
    // better looking and correctly positioned by the scale.
    const even = linearAxis(dataMin, dataMax).ticks;
    return {
      domain,
      ticks: even.filter((t) => t >= domain[0] && t <= domain[1]),
    };
  }

  return { domain, ticks };
}

/** Pick the axis config for the active mode. */
export function buildAxis(
  mode: AxisScale,
  dataMin: number,
  dataMax: number,
  constant: number
): AxisConfig {
  return mode === "log"
    ? symlogAxis(dataMin, dataMax, constant)
    : linearAxis(dataMin, dataMax);
}

/**
 * Compact tick label for CAD cents: "$250", "-$1,000", "$5,717.48".
 * Ladder ticks are always whole dollars, so the cents are dropped; the tooltip
 * keeps full precision separately.
 */
export function formatCentsTick(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = abs / 100;
  const body =
    abs % 100 === 0
      ? dollars.toLocaleString("en-US")
      : dollars.toFixed(2);
  return `${cents < 0 ? "-" : ""}$${body}`;
}
