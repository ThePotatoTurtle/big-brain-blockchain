/**
 * Trip configuration types.
 *
 * To add a new trip: duplicate an existing config file (e.g. japan2026.ts),
 * edit the fields, and register it in ./index.ts. The page appears at
 * /trips/<slug> automatically.
 */

export interface TripCurrency {
  code: string; // ISO code, e.g. "CAD", "JPY"
  symbol: string; // "$", "¥"
  decimals: number; // 2 for CAD (cents), 0 for JPY (yen)
}

/** Freeform label/value pairs rendered under the trip header. */
export interface TripDetailItem {
  label: string;
  value: string;
}

export interface TripConfig {
  slug: string; // URL path segment: /trips/<slug>
  name: string; // display name
  memberIds: number[]; // user ids from src/lib/users.ts
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** Optional freeform details shown under the header. */
  details?: TripDetailItem[];
  /** First currency is the default selection in entry forms. */
  currencies: TripCurrency[];
  /** Category is required on every entry; include "Others" as catch-all. */
  categories: string[];
  /** Payment method is optional; "Others" lets the user fill in text. */
  paymentMethods: string[];
}

/** Convert a user-typed amount string to integer minor units (cents/yen). */
export function toMinorUnits(input: string | number, decimals: number): number {
  const num =
    typeof input === "string" ? parseAmountExpression(input) : input;
  if (isNaN(num)) return 0;
  return Math.round(num * Math.pow(10, decimals));
}

/** Format integer minor units for display: 1250/CAD -> "$12.50", 1250/JPY -> "¥1,250". */
export function formatMoney(minor: number, currency: TripCurrency): string {
  const abs = Math.abs(minor);
  const major = abs / Math.pow(10, currency.decimals);
  const str =
    currency.decimals === 0
      ? major.toLocaleString("en-US")
      : major.toFixed(currency.decimals);
  return `${minor < 0 ? "-" : ""}${currency.symbol}${str}`;
}

/** Minor units -> plain input value string ("12.50", "1250"). */
export function minorToInputValue(minor: number, decimals: number): string {
  return (Math.abs(minor) / Math.pow(10, decimals)).toFixed(decimals);
}

/** Simple +/- expression support, mirroring evaluateExpression in utils.ts. */
function parseAmountExpression(expr: string): number {
  const trimmed = expr.trim();
  if (!trimmed) return NaN;
  const tokens = trimmed.match(/[+-]?[^+-]+/g);
  if (!tokens) return NaN;
  let sum = 0;
  for (const token of tokens) {
    const val = parseFloat(token.trim());
    if (isNaN(val)) return NaN;
    sum += val;
  }
  return sum;
}
