import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminStock } from '@/lib/stocks/admin-queries';
import { StockForm } from '@/components/StockForm';

interface EditStockPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditStockPage({ params }: EditStockPageProps) {
  const { id } = await params;
  const stock = await getAdminStock(id);
  if (!stock) notFound();

  return (
    <div className="mx-auto max-w-screen-md px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/stocks" className="text-xs text-fg-muted hover:text-fg">
          ← Back to stocks
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          Edit {stock.symbol}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">{stock.name}</p>
      </div>
      <StockForm
        initial={{
          symbol: stock.symbol,
          name: stock.name,
          market: stock.market as 'US' | 'HK',
          currency: stock.currency,
          exchange: stock.exchange,
          sector: stock.sector,
          industry: stock.industry,
          isActive: stock.isActive,
        }}
        submitLabel="Save changes"
      />
    </div>
  );
}
