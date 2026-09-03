-- ============================================================================
-- EyesInvest — 60-day max drawdown (60D pullback) — medium-term mirror of
-- `max_drawdown_30d` over a 60-trading-day trailing window. Same peak-to-
-- trough semantics: the most negative (close / 60d-peak − 1) observed in
-- any trailing 60-day window ending at each as_of_date. Stored as a
-- negative fraction (e.g. −0.18 = 18% below the 60-day peak). Null until
-- ≥60 trading days of history exist (`min_periods = window` in
-- `_max_drawdown`).
--
-- Sibling of `max_drawdown_30d` (migration 0004). Lets the screener and
-- stock-detail Risk panel compare short- vs medium-term pullback depth
-- without changing the short-squeeze composite — that stays on 30D.
--
-- Populated by sync-analytics alongside max_drawdown_30d. Nullable; pre-
-- 0018 rows stay valid until the worker overwrites them.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists max_drawdown_60d numeric(10,6);