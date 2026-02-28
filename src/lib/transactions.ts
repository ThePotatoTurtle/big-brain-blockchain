export interface TransactionLineInput {
  userId: number;
  amount: number; // cents: positive = credit, negative = debit
}

/**
 * Compute transaction lines for an expense (supports multiple payers).
 *
 * Each payer paid some amount IRL. Each person in `shares` owes their share.
 * A payer may also be in the shares list (they owe their own portion).
 *
 * For each person, net = (what they paid) - (what they owe).
 * Sum of all lines = 0 (enforced by construction when payers sum = shares sum).
 */
export function computeExpenseLines(
  payers: { userId: number; amountCents: number }[],
  shares: { userId: number; amountCents: number }[]
): TransactionLineInput[] {
  const netMap = new Map<number, number>();

  for (const payer of payers) {
    netMap.set(payer.userId, (netMap.get(payer.userId) ?? 0) + payer.amountCents);
  }

  for (const share of shares) {
    netMap.set(share.userId, (netMap.get(share.userId) ?? 0) - share.amountCents);
  }

  const lines: TransactionLineInput[] = [];
  for (const [userId, amount] of netMap) {
    if (amount !== 0) {
      lines.push({ userId, amount });
    }
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
