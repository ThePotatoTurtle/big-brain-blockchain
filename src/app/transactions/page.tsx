import { getTransactionsPage } from "@/lib/transaction-query";
import { filtersFromParams } from "@/lib/transaction-filters";
import TransactionList from "@/components/TransactionList";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = filtersFromParams({
    get: (name) => {
      const v = params[name];
      return Array.isArray(v) ? v[0] : v;
    },
  });
  // Main ledger only — trips have their own pages
  const { transactions, total } = await getTransactionsPage({ tripId: null, skip: 0, take: 20, filters });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-lg font-bold mb-4">Transactions</h1>
      <TransactionList initialTransactions={transactions} initialTotal={total} initialFilters={filters} />
    </div>
  );
}
