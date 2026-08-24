-- ============================================================================
-- EyesInvest — Phase 3+ sector strength
--
-- Adds per-stock metrics to `ey_stock_analytics`:
--   volume_efficiency   — |changePct| / (volume / sharesOutstanding × 100) for latest day
--   crowded_ratio       — MA5(volume) / MA30(volume) for latest day
--   relative_strength   — return_N(stock) − return_N(market) for the stock's market
--
-- Creates `ey_sector_daily` — one row per (sector, as_of_date) with sector-aggregated
-- breadth, equal-weight returns, RS vs global market, mean efficiency, mean crowded ratio.
--
-- Idempotent: re-runnable on databases that already have these objects.
-- ============================================================================

-- ===== Add columns to ey_stock_analytics =====
alter table public.ey_stock_analytics
  add column if not exists volume_efficiency   numeric(18,6),
  add column if not exists crowded_ratio       numeric(10,6),
  add column if not exists relative_strength   numeric(18,6);

-- ===== Per-sector, per-day aggregates =====
create table if not exists public.ey_sector_daily (
  sector                 text        not null,                    -- e.g. 'Financial Services'
  as_of_date             date        not null,

  -- Constituents
  member_count           smallint    not null,

  -- Equal-weight trailing returns, percent (matches ey_stock_analytics scale)
  sector_return_1m       numeric(10,6),
  sector_return_3m       numeric(10,6),
  sector_return_6m       numeric(10,6),
  sector_return_1y       numeric(10,6),

  -- Sector vs global market benchmark (sector return − mean(SPX, HSI) return), percent points
  rs_vs_market_1m        numeric(10,6),
  rs_vs_market_3m        numeric(10,6),
  rs_vs_market_6m        numeric(10,6),
  rs_vs_market_1y        numeric(10,6),

  -- Breadth: % of constituents with positive return_1m (percent, 0..100)
  breadth_pct            numeric(5,2),

  -- Means across members
  volume_efficiency_mean numeric(18,6),
  crowded_ratio_mean     numeric(10,6),

  source                 text        not null default 'worker',
  computed_at            timestamptz not null default now(),

  primary key (sector, as_of_date)
);

-- Index for the "latest snapshot across all sectors" dashboard path.
create index if not exists ey_sector_daily_date_idx
  on public.ey_sector_daily (as_of_date desc);

-- ===== RLS — public read, service-role writes =====
alter table public.ey_sector_daily enable row level security;

drop policy if exists "sector_daily_public_read" on public.ey_sector_daily;
create policy "sector_daily_public_read"
  on public.ey_sector_daily for select
  using (true);

-- No new policies needed on ey_stock_analytics — the existing
-- "stock_analytics_public_read" from 0004 covers the 3 new columns automatically.
