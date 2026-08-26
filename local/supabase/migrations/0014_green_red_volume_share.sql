-- ============================================================================
-- EyesInvest — Green/red volume share (1M) — SIGNED encoding
-- Adds one nullable column to ey_stock_analytics:
--   green_red_volume_share_1m  — sum(volume on up-bars) ÷
--                                (sum(volume on up-bars) + sum(volume on down-bars))
--                                over a trailing 21-day window (matches the
--                                stocks page Range picker "1M" = 21 trading
--                                days, so the screener and stocks page agree),
--                                encoded with a sign so the colour zone is
--                                explicit:
--                                  green dominant (share ≥ 0.5)  → +share
--                                  red   dominant (share  < 0.5)  → −(1 − share)
--                                (i.e. magnitude is always the dominant side)
--
-- Sibling to `green_red_volume_ratio_1m` (avg_green / avg_red) — see migration
-- 0008. Share weights high-volume days more heavily than the ratio; e.g. one
-- huge green day can swing share toward 1.0 without moving the ratio much.
--
-- Bars where close == open (dojis) are excluded from both sums — they don't
-- move the price and shouldn't move the share either.
--
-- Range: [-1, 1] (was [0, 1] pre-signing; pre-signed rows get rewritten by
-- the next sync-analytics run).
-- Nullable; pre-0014 rows stay valid until the worker overwrites them.
-- Populated by sync-analytics alongside green_red_volume_ratio_1m.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists green_red_volume_share_1m numeric(6,4);