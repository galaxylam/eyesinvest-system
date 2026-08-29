import 'server-only';
import { createAdminClient, isSupabaseWritable } from '@/lib/supabase/admin';
import type {
  MappingStatus,
  NewsStockMappingDto,
  StockRelationshipDto,
} from '@eyesinvest/types';
import {
  getAllMockPendingNewsMappings,
  getAllMockPendingRelationships,
  getMockPendingNewsMapping,
  getMockPendingRelationship,
} from './mock-data';

/**
 * Admin-side queue reads for the news / AI workflow. Three modes:
 *   1. `listPendingNewsMappings` — queue for the /news page
 *   2. `listPendingRelationships` — queue for the /relationships page
 *   3. `getNewsMappingDetail` — single mapping for the /news/[id] page
 *
 * All three fall back to the bundled mock set when Supabase isn't
 * configured so the admin UI is browseable during local development.
 */

export interface PendingNewsMappingsResult {
  rows: NewsStockMappingDto[];
  source: 'supabase' | 'mock';
}

export interface PendingRelationshipsResult {
  rows: StockRelationshipDto[];
  source: 'supabase' | 'mock';
}

// PostgREST joined-select. FK constraint names come from the 0016 migration
// (`<table>_<column>_fkey` Postgres default), so we can pin them explicitly.
const NEWS_MAPPING_SELECT =
  'id, article_id, stock_id, sentiment, impact_direction, impact_severity, ' +
  'confidence, rationale, status, approved_by, approved_at, reviewer_notes, ' +
  'created_at, source, ' +
  'ey_news_article!ey_news_stock_mapping_article_id_fkey(' +
  '  id, source_url, source_name, title, summary, published_at, fetched_at, language' +
  '), ' +
  'ey_stocks!ey_news_stock_mapping_stock_id_fkey(id, symbol, market, name)';

const RELATIONSHIP_SELECT =
  'id, source_stock_id, target_stock_id, relationship_type, confidence, ' +
  'rationale, evidence_news_id, status, approved_by, approved_at, ' +
  'reviewer_notes, created_at, source, ' +
  'src_stock:ey_stocks!ey_stock_relationship_source_stock_id_fkey(id, symbol, market, name), ' +
  'tgt_stock:ey_stocks!ey_stock_relationship_target_stock_id_fkey(id, symbol, market, name)';

function mapNewsRow(r: any): NewsStockMappingDto {
  return {
    id: r.id,
    articleId: r.article_id,
    stockId: r.stock_id,
    sentiment: r.sentiment,
    impactDirection: r.impact_direction,
    impactSeverity: r.impact_severity,
    confidence: r.confidence,
    rationale: r.rationale,
    status: r.status,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    reviewerNotes: r.reviewer_notes,
    createdAt: r.created_at,
    source: r.source,
    article: {
      id: r.ey_news_article.id,
      sourceUrl: r.ey_news_article.source_url,
      sourceName: r.ey_news_article.source_name,
      title: r.ey_news_article.title,
      summary: r.ey_news_article.summary,
      publishedAt: r.ey_news_article.published_at,
      fetchedAt: r.ey_news_article.fetched_at,
      language: r.ey_news_article.language,
    },
    stock: {
      id: r.ey_stocks.id,
      symbol: r.ey_stocks.symbol,
      market: r.ey_stocks.market,
      name: r.ey_stocks.name,
    },
  };
}

function mapRelationshipRow(r: any): StockRelationshipDto {
  return {
    id: r.id,
    sourceStockId: r.source_stock_id,
    targetStockId: r.target_stock_id,
    relationshipType: r.relationship_type,
    confidence: r.confidence,
    rationale: r.rationale,
    evidenceNewsId: r.evidence_news_id,
    status: r.status,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    reviewerNotes: r.reviewer_notes,
    createdAt: r.created_at,
    // Omit the row's provenance `source` (DB column) — the DTO uses
    // `source` / `target` for the joined stock refs.
    source: {
      id: r.src_stock.id,
      symbol: r.src_stock.symbol,
      market: r.src_stock.market,
      name: r.src_stock.name,
    },
    target: {
      id: r.tgt_stock.id,
      symbol: r.tgt_stock.symbol,
      market: r.tgt_stock.market,
      name: r.tgt_stock.name,
    },
  };
}

export async function listPendingNewsMappings(
  limit = 200,
): Promise<PendingNewsMappingsResult> {
  return listNewsMappingsByStatus('pending', limit);
}

/**
 * Generic news-mapping fetch by status. Used by /news (Approved +
 * Rejected tabs) and by /news/[id]'s related-mappings sidebar.
 */
export async function listNewsMappingsByStatus(
  status: MappingStatus,
  limit = 200,
): Promise<PendingNewsMappingsResult> {
  if (!isSupabaseWritable()) {
    return {
      rows: getAllMockPendingNewsMappings().filter((m) => m.status === status),
      source: 'mock',
    };
  }
  try {
    // Use the service-role client — anon client is RLS-restricted to
    // status='approved' rows only, which would hide every pending row
    // from the admin queue. The admin app needs full visibility.
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('ey_news_stock_mapping')
      .select(NEWS_MAPPING_SELECT)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return {
      rows: (data ?? []).map(mapNewsRow),
      source: 'supabase',
    };
  } catch (err) {
    console.error(`[news admin-queries] listNewsMappingsByStatus(${status}) fallback:`, err);
    return {
      rows: getAllMockPendingNewsMappings().filter((m) => m.status === status),
      source: 'mock',
    };
  }
}

export async function listPendingRelationships(
  limit = 200,
): Promise<PendingRelationshipsResult> {
  return listAllRelationships('pending', limit);
}

/**
 * Generic relationship fetch by status. Used by /relationships' Approved +
 * Rejected tabs and by /relationships/[id]'s related-edges sidebar.
 */
export async function listAllRelationships(
  status: MappingStatus,
  limit = 200,
): Promise<PendingRelationshipsResult> {
  if (!isSupabaseWritable()) {
    return {
      rows: getAllMockPendingRelationships().filter((r) => r.status === status),
      source: 'mock',
    };
  }
  try {
    // Use the service-role client — anon client is RLS-restricted to
    // status='approved' rows only, which would hide every pending row
    // from the admin queue. The admin app needs full visibility.
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('ey_stock_relationship')
      .select(RELATIONSHIP_SELECT)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return {
      rows: (data ?? []).map(mapRelationshipRow),
      source: 'supabase',
    };
  } catch (err) {
    console.error(`[relationships admin-queries] listAllRelationships(${status}) fallback:`, err);
    return {
      rows: getAllMockPendingRelationships().filter((r) => r.status === status),
      source: 'mock',
    };
  }
}

export async function getNewsMappingDetail(
  id: string,
): Promise<NewsStockMappingDto | null> {
  if (!isSupabaseWritable()) {
    return getMockPendingNewsMapping(id);
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('ey_news_stock_mapping')
      .select(NEWS_MAPPING_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapNewsRow(data);
  } catch (err) {
    console.error('[news admin-queries] getNewsMappingDetail fallback:', err);
    return getMockPendingNewsMapping(id);
  }
}

export async function getRelationshipDetail(
  id: string,
): Promise<StockRelationshipDto | null> {
  if (!isSupabaseWritable()) {
    return getMockPendingRelationship(id);
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('ey_stock_relationship')
      .select(RELATIONSHIP_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapRelationshipRow(data);
  } catch (err) {
    console.error('[relationships admin-queries] getRelationshipDetail fallback:', err);
    return getMockPendingRelationship(id);
  }
}