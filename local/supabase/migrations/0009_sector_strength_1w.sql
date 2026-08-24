-- ============================================================================
-- EyesInvest — Phase 3+ sector strength (1-week window)
--
-- Adds a 1-week trailing return column to both `ey_stock_analytics` and
-- `ey_sector_daily` so the dashboard leaderboard can surface a shorter
-- recency signal alongside the existing 1m/3m/6m/1y set.
--
-- Idempotent — re-runnable on databases that already have these columns.
-- Apply after `0008_sector_strength.sql`.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists return_1w numeric(10,6);

alter table public.ey_sector_daily
  add column if not exists sector_return_1w  numeric(10,6),
  add column if not exists rs_vs_market_1w   numeric(10,6);