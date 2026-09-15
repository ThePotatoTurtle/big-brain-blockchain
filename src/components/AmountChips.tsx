"use client";

/**
 * Sign / expression helpers rendered inside an amount field.
 *
 * Mobile keypads (`inputMode="decimal"`) expose no + or -, which left negative
 * "rebate/refund" entries unreachable on phones entirely — there is no other
 * sign affordance in the UI. Switching those fields to a full keyboard would
 * regress the common case, and on iOS wouldn't even help: + and - live behind
 * the `123` key there, not on the primary layer.
 *
 * These map to INTENT rather than keystrokes. "±" negates the whole value, so
 * it is correct wherever the caret happens to sit — inserting a literal "-" at
 * the caret would turn "41.74" into "41.7-4" for anyone who taps it after
 * typing the number.
 */

/**
 * Flip the sign of every term, so the expression's total negates.
 * "41.74" -> "-41.74"; "12.50+3.75" -> "-12.50-3.75" (not "-12.50+3.75",
 * which would evaluate to -8.75 rather than the intended -16.25).
 */
export function negateExpression(expr: string): string {
  const trimmed = expr.trim();
  // Empty field: leave a lone "-" so the user can just type the digits after it.
  if (!trimmed) return "-";
  if (trimmed === "-") return "";

  const tokens = trimmed.match(/[+-]?[^+-]+/g);
  if (!tokens) return trimmed;

  return tokens
    .map((token, i) => {
      const t = token.trim();
      const body = t.replace(/^[+-]/, "").trim();
      const wasNegative = t.startsWith("-");
      if (i === 0) return wasNegative ? body : `-${body}`;
      return `${wasNegative ? "+" : "-"}${body}`;
    })
    .join("");
}

/** Append a trailing "+" so another term can be typed. No-op if one is pending. */
export function appendPlus(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed || /[+-]$/.test(trimmed)) return trimmed;
  return `${trimmed}+`;
}

export default function AmountChips({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  // preventDefault on pointer-down keeps focus in the input, so the mobile
  // keypad doesn't dismiss and reopen between taps.
  const hold = (e: React.MouseEvent | React.TouchEvent) => e.preventDefault();

  const chip =
    "px-1.5 py-0.5 rounded-md text-xs font-medium leading-none text-muted " +
    "bg-[var(--card-hover)] hover:text-accent active:opacity-70 transition-colors " +
    "select-none tabular-nums";

  return (
    <div
      className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 ${className}`}
    >
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={hold}
        onTouchStart={hold}
        onClick={() => onChange(negateExpression(value))}
        title="Make negative (rebate/refund)"
        aria-label="Toggle negative"
        className={chip}
      >
        ±
      </button>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={hold}
        onTouchStart={hold}
        onClick={() => onChange(appendPlus(value))}
        title="Add another amount"
        aria-label="Add a term"
        className={chip}
      >
        +
      </button>
    </div>
  );
}
