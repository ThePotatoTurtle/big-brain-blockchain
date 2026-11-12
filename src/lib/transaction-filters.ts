/** Filters for the Transactions list. Client-safe (no database imports). */
export interface TransactionFilters {
  q?: string; // matches item or notes, case-insensitive
  userId?: number; // has a ledger line on the entry
  type?: "expense" | "settlement";
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  id?: number; // single entry (deep link)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ParamSource = { get(name: string): string | null | undefined };

/** Parse filters from a query string, dropping anything malformed. */
export function filtersFromParams(params: ParamSource): TransactionFilters {
  const filters: TransactionFilters = {};
  const q = params.get("q")?.trim();
  if (q) filters.q = q;
  const userId = Number(params.get("user"));
  if (Number.isInteger(userId) && userId > 0) filters.userId = userId;
  const type = params.get("type");
  if (type === "expense" || type === "settlement") filters.type = type;
  const from = params.get("from");
  if (from && DATE_RE.test(from)) filters.from = from;
  const to = params.get("to");
  if (to && DATE_RE.test(to)) filters.to = to;
  const id = Number(params.get("id"));
  if (Number.isInteger(id) && id > 0) filters.id = id;
  return filters;
}

/** Serialize filters as a query string (no leading "?"); empty when none set. */
export function filtersToQuery(filters: TransactionFilters): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.userId) params.set("user", String(filters.userId));
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.id) params.set("id", String(filters.id));
  return params.toString();
}

export function hasActiveFilters(filters: TransactionFilters): boolean {
  return filtersToQuery(filters) !== "";
}
