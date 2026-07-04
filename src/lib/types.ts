export interface Balance {
  userId: number;
  name: string;
  balanceCents: number;
  color: string;
}

export interface TransactionLineDetail {
  userId: number;
  userName: string;
  amount: number; // cents
  color: string;
}

export interface AttachmentDetail {
  id: number;
  fileUrl: string;
  fileName: string;
}

export interface TransactionWithDetails {
  id: number;
  date: string;
  type: "expense" | "settlement";
  item: string;
  notes: string | null;
  totalAmountCents: number | null;
  status: "pending" | "confirmed";
  createdBy: { id: number; name: string };
  lines: TransactionLineDetail[];
  attachments: AttachmentDetail[];
  createdAt: string;
  // Trip fields (null/absent for main-ledger entries)
  tripId?: string | null;
  currency?: string; // "CAD" (default) or another trip currency code
  paymentMethod?: string | null;
  category?: string | null;
  shares?: { userId: number; amountCents: number }[] | null; // gross shares (stats)
  payers?: { userId: number; amountCents: number }[] | null; // original payers
  conversionBatchId?: string | null; // set on paired currency-conversion entries
  transfer?: TripTransferSummary | null; // set on trip-close transfer entries
}

/** Rich summary attached to a main-ledger trip-close transfer entry. */
export interface TripTransferSummary {
  tripSlug: string;
  tripName: string;
  startDate: string;
  endDate: string;
  memberIds: number[];
  transferredAt: string; // ISO timestamp
  // Net main-ledger balance change per user, CAD cents (+owed / −owes)
  transferred: { userId: number; amountCents: number }[];
  // Total gross spending per currency (minor units), self-entries included
  currencyTotals: Record<string, number>;
  // category totals per currency: currency -> category -> minor units
  categoryTotals: Record<string, Record<string, number>>;
  // per-person totals per currency: currency -> userId -> minor units
  perPerson: Record<string, Record<number, number>>;
}

export interface BalanceHistoryPoint {
  date: string;
  [userName: string]: number | string;
}

// Optional trip metadata accepted on create/update requests
export interface TripEntryFields {
  tripId?: string;
  currency?: string;
  paymentMethod?: string;
  category?: string;
}

// API request types
export interface CreateExpenseRequest extends TripEntryFields {
  date: string;
  item: string;
  notes?: string;
  createdById: number;
  payers: { userId: number; amountCents: number }[];
  totalAmountCents: number;
  shares: { userId: number; amountCents: number }[];
  attachmentUrls?: { fileUrl: string; fileName: string }[];
}

export interface CreateSettlementRequest extends TripEntryFields {
  date: string;
  item: string;
  notes?: string;
  createdById: number;
  fromUserId: number;
  toUserId: number;
  amountCents: number;
  attachmentUrls?: { fileUrl: string; fileName: string }[];
}

export type CreateTransactionRequest =
  | ({ type: "expense" } & CreateExpenseRequest)
  | ({ type: "settlement" } & CreateSettlementRequest);
