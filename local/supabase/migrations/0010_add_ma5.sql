-- ============================================================================
-- EyesInvest — Add MA5 (5-day moving average) to ey_stock_analytics.
--
-- MA20/MA50/MA200 were introduced in migration 0004. This adds a 5-day MA
-- alongside them so the stock-detail chart legend can offer MA5 as a
-- 4th toggleable overlay alongside MA20 / MA50 / MA200.
--
-- Idempotent: re-runnable on databases that already have the column.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists ma5 numeric(18,6);