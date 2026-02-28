export interface TransactionLineInput {
  userId: number;
  amount: number; // cents: positive = credit, negative = debit
}

/**
 * Compute transaction lines for an expense.
 *
 * The payer paid `totalPaidCents` IRL. Each person in `shares` owes their share.
 * The payer may also be in the shares list (they owe their own portion).
 *
 * Lines:
 * - Payer gets a net credit: totalPaidCents - (their share, if in split)
 * - Each non-payer gets a debit: -(their share)
 *
 * Sum of all lines = 0 (enforced by construction).
 */
export function computeExpenseLines(
  payerId: number,
  totalPaidCents: number,
  shares: { userId: number; amountCents: number }[]
): TransactionLineInput[] {
  const lines: TransactionLineInput[] = [];
  let payerShareCents = 0;

  for (const share of shares) {
    if (share.userId === payerId) {
      payerShareCents = share.amountCents;
    } else {
      lines.push({ userId: share.userId, amount: -share.amountCents });
    }
  }

  // Payer's net: what they paid minus what they owe
  const payerNet = totalPaidCents - payerShareCents;
  if (payerNet !== 0) {
    lines.push({ userId: payerId, amount: payerNet });
  }

  return lines;
}

/**
 * Compute transaction lines for a settlement (person-to-person payment).
 *
 * fromUser paid toUser some amount IRL.
 * - fromUser: +amountCents (their balance goes up, they paid money out)
 * - toUser: -amountCents (their balance goes down, they received money)
 */
export function computeSettlementLines(
  fromUserId: number,
  toUserId: number,
  amountCents: number
): TransactionLineInput[] {
  return [
    { userId: fromUserId, amount: amountCents },
    { userId: toUserId, amount: -amountCents },
  ];
}

/**
 * Validate that transaction lines sum to zero.
 */
export function validateZeroSum(lines: TransactionLineInput[]): boolean {
  const sum = lines.reduce((acc, line) => acc + line.amount, 0);
  return sum === 0;
}
