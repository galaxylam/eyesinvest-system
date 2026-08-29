-- ============================================================================
-- EyesInvest — News ingestion + AI analysis (Phase 7 + Phase 8)
--
-- Three new tables:
--
--   ey_news_article        — raw RSS articles, deduped by source_url
--                            (UNIQUE). One row per article ever seen, even
--                            if its mappings are later rejected — the article
--                            is the immutable provenance trail.
--
--   ey_news_stock_mapping  — junction: which stocks an article affects,
--                            plus the AI's per-impact analysis (sentiment,
--                            direction, severity, confidence, rationale).
--                            Status 'pending' on write; admin flips to
--                            'approved' | 'rejected' to make it canonical.
--
--   ey_stock_relationship  — the "knowledge graph": stock ↔ stock edges
--                            (supplier / competitor / customer / partner /
--                            parent_subsidiary). Same status workflow as
--                            mappings; canonical edges are reused across runs.
--
-- Worker contract (`sync-news`):
--   * Inserts ey_news_article rows on first sight (deduped by source_url)
--   * Inserts ey_news_stock_mapping rows with status='pending' on every
--     run where the LLM produces a suggestion
--   * Inserts ey_stock_relationship rows with status='pending' on every
--     run where the LLM proposes an edge
--   * Never overwrites status / approved_by / approved_at / reviewer_notes
--     (admin writes those columns)
--
-- Admin contract (`apps/admin /news` + `/relationships`):
--   * Lists pending rows, lets admin edit AI fields, then approve / reject
--   * Bulk-approve selected rows; skip deletes a row outright (the LLM was
--     wrong — no need to keep a "rejected" tombstone)
--   * approved_by is stamped from EY_ADMIN_DEFAULT_USER ('local-dev' until
--     Phase N auth lands)
--
-- RLS:
--   * ey_news_article         — public read (using (true))
--   * ey_news_stock_mapping   — only status='approved' rows visible to anon
--                               (pending AI output shouldn't leak)
--   * ey_stock_relationship   — same as mapping
--   All writes go through the service-role client (worker + admin),
--   which bypasses RLS.
--
-- Idempotent: every CREATE uses IF NOT EXISTS, every ALTER uses
-- ADD COLUMN IF NOT EXISTS / ADD CONSTRAINT only when not present.
-- ============================================================================

-- ===== 1. Raw articles ====================================================
create table if not exists public.ey_news_article (
  id            uuid primary key default gen_random_uuid(),
  source_url    text not null unique,                 -- dedupe key
  source_name   text not null,                        -- e.g. 'Reuters', 'Yahoo Finance'
  title         text not null,
  summary       text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  language      text not null default 'en' check (language in ('en')),
  raw_metadata  jsonb,                                -- feedparser's parsed entry (sans raw bytes)
  created_at    timestamptz not null default now(),
  source        text not null default 'rss'
);

create index if not exists idx_ey_news_article_published_at
  on public.ey_news_article (published_at desc);
create index if not exists idx_ey_news_article_source_name
  on public.ey_news_article (source_name, published_at desc);
create index if not exists idx_ey_news_article_fetched_at
  on public.ey_news_article (fetched_at desc);

-- ===== 2. Article ↔ Stock mappings ========================================
create table if not exists public.ey_news_stock_mapping (
  id                  uuid primary key default gen_random_uuid(),
  article_id          uuid not null
                        references public.ey_news_article(id) on delete cascade,
  stock_id            uuid not null
                        references public.ey_stocks(id) on delete cascade,

  -- AI suggestions (nullable so partial / parse failures don't block writes):
  sentiment           text check (sentiment in ('bullish','bearish','neutral')),
  impact_direction    text check (impact_direction in ('positive','negative','mixed','none')),
  impact_severity     text check (impact_severity in ('low','medium','high','critical')),
  confidence          numeric(4,3) check (confidence >= 0 and confidence <= 1),
  rationale           text,

  -- Approval workflow:
  status              text not null default 'pending'
                        check (status in ('pending','approved','rejected')),
  approved_by         text,
  approved_at         timestamptz,
  reviewer_notes      text,

  created_at          timestamptz not null default now(),
  source              text not null default 'openrouter'
);

-- Natural key: one mapping per (article, stock). Re-runs of sync-news that
-- propose the same article<->stock edge UPDATE the AI columns in place; the
-- worker's UPSERT onConflict uses this index.
create unique index if not exists uq_ey_news_stock_mapping_article_stock
  on public.ey_news_stock_mapping (article_id, stock_id);

-- Queue reads ("show pending") — partial index so it's tiny in prod.
create index if not exists idx_ey_news_stock_mapping_status_pending
  on public.ey_news_stock_mapping (created_at desc)
  where status = 'pending';

-- "All mappings for this stock" reads from the public app (approved-only).
-- Uses `created_at` (when the mapping row was last written / refreshed) —
-- `published_at` lives on ey_news_article, not on this junction table.
create index if not exists idx_ey_news_stock_mapping_stock_approved
  on public.ey_news_stock_mapping (stock_id, created_at desc)
  where status = 'approved';

-- ===== 3. Stock ↔ Stock relationships (the knowledge graph) =============
create table if not exists public.ey_stock_relationship (
  id                  uuid primary key default gen_random_uuid(),
  source_stock_id     uuid not null
                        references public.ey_stocks(id) on delete cascade,
  target_stock_id     uuid not null
                        references public.ey_stocks(id) on delete cascade,
  relationship_type   text not null
                        check (relationship_type in ('supplier','competitor','customer','partner','parent_subsidiary')),
  confidence          numeric(4,3) check (confidence >= 0 and confidence <= 1),
  rationale           text,
  evidence_news_id    uuid
                        references public.ey_news_article(id) on delete set null,

  -- Approval workflow:
  status              text not null default 'pending'
                        check (status in ('pending','approved','rejected')),
  approved_by         text,
  approved_at         timestamptz,
  reviewer_notes      text,

  created_at          timestamptz not null default now(),
  source              text not null default 'openrouter',

  -- Prevent self-loops and duplicate active edges:
  check (source_stock_id <> target_stock_id)
);

-- Natural key for the worker upsert: one (source, target, type) edge.
create unique index if not exists uq_ey_stock_relationship_pair_type
  on public.ey_stock_relationship (source_stock_id, target_stock_id, relationship_type);

-- Queue reads — partial index, pending rows only.
create index if not exists idx_ey_stock_relationship_status_pending
  on public.ey_stock_relationship (created_at desc)
  where status = 'pending';

-- "What edges leave / enter this stock?" reads from the public app.
create index if not exists idx_ey_stock_relationship_source_approved
  on public.ey_stock_relationship (source_stock_id, relationship_type)
  where status = 'approved';
create index if not exists idx_ey_stock_relationship_target_approved
  on public.ey_stock_relationship (target_stock_id, relationship_type)
  where status = 'approved';

-- ===== 4. Row Level Security ============================================
alter table public.ey_news_article       enable row level security;
alter table public.ey_news_stock_mapping enable row level security;
alter table public.ey_stock_relationship enable row level security;

-- News articles: public read (they're public-domain data from RSS).
drop policy if exists ey_news_article_select_public on public.ey_news_article;
create policy ey_news_article_select_public
  on public.ey_news_article for select
  using (true);

-- AI tables: only approved rows visible to anon / authenticated.
-- Pending AI output is hidden so unverified suggestions don't leak to the
-- public site. Admin reads via service-role which bypasses RLS.
drop policy if exists ey_news_stock_mapping_select_approved on public.ey_news_stock_mapping;
create policy ey_news_stock_mapping_select_approved
  on public.ey_news_stock_mapping for select
  using (status = 'approved');

drop policy if exists ey_stock_relationship_select_approved on public.ey_stock_relationship;
create policy ey_stock_relationship_select_approved
  on public.ey_stock_relationship for select
  using (status = 'approved');