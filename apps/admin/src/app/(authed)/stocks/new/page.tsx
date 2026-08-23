import Link from 'next/link';
import { StockForm } from '@/components/StockForm';

export default function NewStockPage() {
  return (
    <div className="mx-auto max-w-screen-md px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/stocks" className="text-xs text-fg-muted hover:text-fg">
          ← Back to stocks
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">New stock</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Add a stock to the master universe. Writes go through the service-role client.
        </p>
      </div>
      <StockForm />
    </div>
  );
}
