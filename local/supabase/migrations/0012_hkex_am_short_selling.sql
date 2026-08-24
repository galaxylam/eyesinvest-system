-- ============================================================================
-- EyesInvest — HKEX morning-session short-selling turnover
--
-- Adds three nullable columns to `ey_short_sale_1d` so the worker can capture
-- the HKEX AM (morning-session) short-selling turnover page in the same row as
-- the full-day turnover, regardless of which is published first.
--
--   am_short_volume    — HKEX MSHTMAIN shares for the morning session,
--                        null until ~12:00–13:00 HKT when HKEX publishes
--                        the AM page (around lunch break).
--   am_short_value_hkd — HKEX MSHTMAIN HKD turnover for the morning session,
--                        same publication window as am_short_volume.
--   am_published_at    — when the worker first captured the AM row, useful
--                        for debugging staleness vs full-day re-publishes.
--
-- The combined sync (sync_hkex_short_sales_combined) writes both AM and
-- full-day fields in a single upsert. When AM is published but full-day is
-- not yet out, short_volume is set to 0 (placeholder) so the chart shows
-- only the AM bar; the full-day bar appears when full-day is published.
--
-- Idempotent: re-runnable on databases that already have these columns.
-- ============================================================================

alter table public.ey_short_sale_1d
  add column if not exists am_short_volume     bigint,
  add column if not exists am_short_value_hkd  numeric(18,6),
  add column if not exists am_published_at     timestamptz;