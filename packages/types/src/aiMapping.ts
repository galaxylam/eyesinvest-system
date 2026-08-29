import type { NewsArticleDto, NewsStockRef } from './newsArticle';

/**
 * Phase 8 AI analysis — the shared contract between worker writes and
 * admin reads. Three tables; two rows types plus two DTOs (one each for
 * mappings and relationships), with joined fields baked in.
 */

// ===== Enum-style unions (text + CHECK in SQL, union in TS) ===============

export type MappingStatus = 'pending' | 'approved' | 'rejected';

export type Sentiment = 'bullish' | 'bearish' | 'neutral';
export type ImpactDirection = 'positive' | 'negative' | 'mixed' | 'none';
export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RelationshipType =
  | 'supplier'
  | 'competitor'
  | 'customer'
  | 'partner'
  | 'parent_subsidiary';

// ===== News <-> Stock mapping ============================================

/**
 * Raw DB row shape for `ey_news_stock_mapping`. Worker writes these with
 * status='pending'; admin flips to approved/rejected. Natural key:
 * (article_id, stock_id) — re-runs of the worker update AI columns in place.
 */
export interface NewsStockMappingRow {
  id: string;
  articleId: string;
  stockId: string;
  sentiment: Sentiment | null;
  impactDirection: ImpactDirection | null;
  impactSeverity: ImpactSeverity | null;
  /** 0..1. */
  confidence: number | null;
  rationale: string | null;
  status: MappingStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewerNotes: string | null;
  createdAt: string;
  source: string;
}

/**
 * Admin-queue DTO: DB row + the joined article + stock so the queue can
 * render "title — symbol" without a second round-trip.
 */
export interface NewsStockMappingDto extends NewsStockMappingRow {
  article: NewsArticleDto;
  stock: NewsStockRef;
}

// ===== Stock <-> Stock relationship (the knowledge graph) ===============

/**
 * Raw DB row shape for `ey_stock_relationship`. Knowledge-graph edge:
 * source_stock → target_stock of a given type. Same status workflow as
 * mappings. Natural key: (source_stock_id, target_stock_id, relationship_type).
 */
export interface StockRelationshipRow {
  id: string;
  sourceStockId: string;
  targetStockId: string;
  relationshipType: RelationshipType;
  confidence: number | null;
  rationale: string | null;
  /** Article that originally suggested this edge (for "why does this exist?" trace). */
  evidenceNewsId: string | null;
  status: MappingStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewerNotes: string | null;
  createdAt: string;
  source: string;
}

/**
 * Admin-queue DTO: row + joined source/target stock refs. Lets the queue
 * render "AAPL → TSMC (supplier, 0.92 confidence)" without joining again.
 *
 * Omits the DB row's `source` provenance string ('openrouter' etc) so we
 * can use the field name for the joined source-stock ref instead.
 */
export type StockRelationshipDto = Omit<StockRelationshipRow, 'source'> & {
  source: NewsStockRef;
  target: NewsStockRef;
};