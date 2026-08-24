-- ============================================================================
-- EyesInvest — Screener filter inputs
--
-- Adds three per-day columns on `ey_stock_analytics` so the screener can offer
-- MA5 / MA20 slope and 1M green-vs-red volume ratio filters without an
-- `ey_price_1d` round-trip per row.
--
--   ma5_slope                 — signed delta of ma5 vs the prior trading day
--   ma20_slope                — signed delta of ma20 vs the prior trading day
--   green_red_volume_ratio_1m — mean(volume on close>open) ÷ mean(volume on
--                                close<open) over the trailing 30 trading days
--
-- All three are nullable on day-1 rows; the screener passes rows whose value
-- is null when no filter is applied.
--
-- Idempotent: re-runnable on databases that already have these columns.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists ma5_slope                  numeric(18,6),
  add column if not exists ma20_slope                 numeric(18,6),
  add column if not exists green_red_volume_ratio_1m numeric(18,6);