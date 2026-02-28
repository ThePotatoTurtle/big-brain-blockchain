/**
 * Convert a dollar amount (string or number) to integer cents.
 * "12.50" -> 1250, 12.5 -> 1250
 */
export function dollarsToCents(dollars: string | number): number {
  const num = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Convert integer cents to formatted dollar string.
 * 1250 -> "$12.50", -500 -> "-$5.00", 0 -> "$0.00"
 */
export function centsToDisplay(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  if (cents < 0) return `-$${dollars}`;
  return `$${dollars}`;
}

/**
 * Convert cents to a plain number for form inputs.
 * 1250 -> "12.50"
 */
export function centsToInputValue(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

/**
 * Split totalCents evenly among count people.
 * Returns array of count amounts that sum to exactly totalCents.
 * Remainder cents distributed one-by-one to first recipients.
 *
 * splitEvenly(1000, 3) => [334, 333, 333]
 * splitEvenly(100, 3)  => [34, 33, 33]
 */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, i) =>
    base + (i < remainder ? 1 : 0)
  );
}

/**
 * Format a date string (ISO) to a readable format.
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
export function todayString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}
