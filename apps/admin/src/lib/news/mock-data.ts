import type { NewsStockMappingDto, StockRelationshipDto } from '@eyesinvest/types';

/**
 * Mock pending news mappings — kept in sync with `lib/stocks/mock-data.ts`
 * so the admin queue is browseable without Supabase.
 *
 * IDs are deterministic so the queue + detail pages can render against the
 * same set; UUIDs are fake but valid format (so client-side mocks survive
 * .uuid() validation when the form is wired up).
 */

const uuid = (s: string) => `00000000-0000-4000-8000-${s.padStart(12, '0')}`;

// Stock refs match `lib/stocks/mock-data.ts` ids (`AAPL-US`, `0700.HK-HK`, ...).
const REF_AAPL = { id: 'AAPL-US', symbol: 'AAPL', market: 'US' as const, name: 'Apple Inc.' };
const REF_MSFT = { id: 'MSFT-US', symbol: 'MSFT', market: 'US' as const, name: 'Microsoft Corporation' };
const REF_NVDA = { id: 'NVDA-US', symbol: 'NVDA', market: 'US' as const, name: 'NVIDIA Corporation' };
const REF_TSLA = { id: 'TSLA-US', symbol: 'TSLA', market: 'US' as const, name: 'Tesla Inc.' };
const REF_GOOGL = { id: 'GOOGL-US', symbol: 'GOOGL', market: 'US' as const, name: 'Alphabet Inc.' };
const REF_TENCENT = { id: '0700.HK-HK', symbol: '0700.HK', market: 'HK' as const, name: 'Tencent Holdings Ltd.' };

const NOW = '2026-01-15T10:30:00.000Z';

export const MOCK_PENDING_NEWS_MAPPINGS: NewsStockMappingDto[] = [
  {
    id: uuid('000000000001'),
    articleId: uuid('000000000001'),
    stockId: REF_NVDA.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'high',
    confidence: 0.87,
    rationale: 'New Blackwell GPU wins major hyperscaler order.',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: 'openrouter',
    article: {
      id: uuid('000000000001'),
      sourceUrl: 'https://www.reuters.com/business/nvidia-blackwell-order',
      sourceName: 'Reuters Business',
      title: 'NVIDIA announces new Blackwell GPU, wins major hyperscaler order',
      summary: 'Microsoft, Meta and Oracle commit to multi-billion-dollar Blackwell purchase.',
      publishedAt: '2026-01-15T09:00:00.000Z',
      fetchedAt: NOW,
      language: 'en',
    },
    stock: REF_NVDA,
  },
  {
    id: uuid('000000000002'),
    articleId: uuid('000000000001'),
    stockId: REF_MSFT.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'medium',
    confidence: 0.72,
    rationale: 'Microsoft is among the named hyperscaler customers.',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: 'openrouter',
    article: {
      id: uuid('000000000001'),
      sourceUrl: 'https://www.reuters.com/business/nvidia-blackwell-order',
      sourceName: 'Reuters Business',
      title: 'NVIDIA announces new Blackwell GPU, wins major hyperscaler order',
      summary: 'Microsoft, Meta and Oracle commit to multi-billion-dollar Blackwell purchase.',
      publishedAt: '2026-01-15T09:00:00.000Z',
      fetchedAt: NOW,
      language: 'en',
    },
    stock: REF_MSFT,
  },
  {
    id: uuid('000000000003'),
    articleId: uuid('000000000002'),
    stockId: REF_AAPL.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'high',
    confidence: 0.91,
    rationale: 'Vision Pro 2 launch drives upgrade cycle narrative.',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: 'openrouter',
    article: {
      id: uuid('000000000002'),
      sourceUrl: 'https://finance.yahoo.com/news/apple-vision-pro-2-launch',
      sourceName: 'Yahoo Finance',
      title: 'Apple unveils Vision Pro 2 with $1,999 starting price',
      summary: 'Apple\'s next-gen spatial computer slims down and gains native Apple Intelligence.',
      publishedAt: '2026-01-14T15:30:00.000Z',
      fetchedAt: NOW,
      language: 'en',
    },
    stock: REF_AAPL,
  },
  {
    id: uuid('000000000004'),
    articleId: uuid('000000000003'),
    stockId: REF_TSLA.id,
    sentiment: 'bearish',
    impactDirection: 'negative',
    impactSeverity: 'high',
    confidence: 0.84,
    rationale: 'Voluntary recall affects ~120k vehicles; near-term margin pressure.',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: 'openrouter',
    article: {
      id: uuid('000000000003'),
      sourceUrl: 'https://www.marketwatch.com/tesla-recall-2026',
      sourceName: 'MarketWatch',
      title: 'Tesla recalls 120,000 vehicles over steering software defect',
      summary: 'NHTSA filing cites firmware issue in Model Y / Model 3 builds.',
      publishedAt: '2026-01-14T12:00:00.000Z',
      fetchedAt: NOW,
      language: 'en',
    },
    stock: REF_TSLA,
  },
  {
    id: uuid('000000000005'),
    articleId: uuid('000000000004'),
    stockId: REF_TENCENT.id,
    sentiment: 'bullish',
    impactDirection: 'positive',
    impactSeverity: 'medium',
    confidence: 0.78,
    rationale: 'Tencent Cloud wins several ASEAN public-sector contracts.',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: 'openrouter',
    article: {
      id: uuid('000000000004'),
      sourceUrl: 'https://www.scmp.com/tech/tencent-cloud-asean',
      sourceName: 'SCMP Tech',
      title: 'Tencent Cloud expands aggressively into ASEAN, wins Singapore gov deal',
      summary: 'Counter-program to AWS / Azure; pricing undercuts US hyperscalers by 20-30%.',
      publishedAt: '2026-01-13T08:00:00.000Z',
      fetchedAt: NOW,
      language: 'en',
    },
    stock: REF_TENCENT,
  },
  {
    id: uuid('000000000006'),
    articleId: uuid('000000000005'),
    stockId: REF_GOOGL.id,
    sentiment: 'neutral',
    impactDirection: 'mixed',
    impactSeverity: 'low',
    confidence: 0.55,
    rationale: 'EU antitrust ruling cited as risk; appeal outcome uncertain.',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: 'openrouter',
    article: {
      id: uuid('000000000005'),
      sourceUrl: 'https://www.bloomberg.com/news/google-eu-ruling',
      sourceName: 'Bloomberg',
      title: 'EU court upholds antitrust ruling against Google Search bundling',
      summary: 'Alphabet faces remedies; appeals process expected to take 18+ months.',
      publishedAt: '2026-01-12T17:00:00.000Z',
      fetchedAt: NOW,
      language: 'en',
    },
    stock: REF_GOOGL,
  },
];

export const MOCK_PENDING_RELATIONSHIPS: StockRelationshipDto[] = [
  {
    id: uuid('000000000010'),
    sourceStockId: REF_NVDA.id,
    targetStockId: REF_MSFT.id,
    relationshipType: 'customer',
    confidence: 0.81,
    rationale: 'Microsoft is one of the largest Azure-cloud customers of NVIDIA GPUs.',
    evidenceNewsId: uuid('000000000001'),
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: REF_NVDA,
    target: REF_MSFT,
  },
  {
    id: uuid('000000000011'),
    sourceStockId: REF_AAPL.id,
    targetStockId: REF_GOOGL.id,
    relationshipType: 'competitor',
    confidence: 0.93,
    rationale: 'Both compete in spatial-computing / XR platform layer.',
    evidenceNewsId: uuid('000000000002'),
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: REF_AAPL,
    target: REF_GOOGL,
  },
  {
    id: uuid('000000000012'),
    sourceStockId: REF_TSLA.id,
    targetStockId: REF_TENCENT.id,
    relationshipType: 'partner',
    confidence: 0.41,
    rationale: 'Tencent holds a stake in Tesla via prior investment; relationship is light.',
    evidenceNewsId: null,
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    reviewerNotes: null,
    createdAt: NOW,
    source: REF_TSLA,
    target: REF_TENCENT,
  },
];

export function getAllMockPendingNewsMappings(): NewsStockMappingDto[] {
  return MOCK_PENDING_NEWS_MAPPINGS;
}

export function getMockPendingNewsMapping(
  id: string,
): NewsStockMappingDto | null {
  return MOCK_PENDING_NEWS_MAPPINGS.find((m) => m.id === id) ?? null;
}

export function getAllMockPendingRelationships(): StockRelationshipDto[] {
  return MOCK_PENDING_RELATIONSHIPS;
}

export function getMockPendingRelationship(
  id: string,
): StockRelationshipDto | null {
  return MOCK_PENDING_RELATIONSHIPS.find((r) => r.id === id) ?? null;
}