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
