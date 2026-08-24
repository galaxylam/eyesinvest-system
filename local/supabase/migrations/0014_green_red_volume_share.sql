-- ============================================================================
-- EyesInvest — Green/red volume share (1M)
-- Adds one nullable column to ey_stock_analytics:
--   green_red_volume_share_1m  — sum(volume on up-bars) ÷
--                                (sum(volume on up-bars) + sum(volume on down-bars))
--                                over a trailing 30-day window.
--
-- Sibling to `green_red_volume_ratio_1m` (avg_green / avg_red) — see migration
-- 0008. Share weights high-volume days more heavily than the ratio; e.g. one
-- huge green day can swing share toward 1.0 without moving the ratio much.
--
-- Bars where close == open (dojis) are excluded from both sums — they don't
-- move the price and shouldn't move the share either.
--
-- Range: 0..1 (NaN → NULL when window has no up or no down bars).
-- Nullable; pre-0014 rows stay valid. Populated by sync-analytics alongside
-- green_red_volume_ratio_1m.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists green_red_volume_share_1m numeric(6,4);