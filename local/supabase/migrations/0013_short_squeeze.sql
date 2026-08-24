-- ============================================================================
-- EyesInvest — Short squeeze score
--
-- Adds six nullable columns to `ey_stock_analytics` so the worker can capture
-- the short-squeeze analytical layer in the same `(stock_id, as_of_date)`
-- row as the existing per-day indicators. No new table — extends the
-- analytics row exactly like `sync-sector-strength` did with
-- `volume_efficiency`, `crowded_ratio`, `relative_strength`.
--
--   squeeze_score          — 0..100 composite score (null when insufficient
--                            data; not a synthetic zero)
--   squeeze_dtc            — days to cover = latest short_interest ÷ 30D
--                            avg daily volume
--   squeeze_si_chg_1w      — short-interest % change vs prior settlement
--                            (uses FINRA `change_pct` when present, falls
--                            back to (latest - prior) / prior * 100 for
--                            CDN-only rows)
--   squeeze_drawdown_30d   — snapshot of max_drawdown_30d at compute time
--                            (mirrors `max_drawdown_30d` so the UI panel
--                            can read one column instead of two)
--   squeeze_volume_spike   — mean(volume[-5:]) ÷ mean(volume[-30:])
--                            (short-term vs trailing month)
--   squeeze_am_ratio       — HK-only AM share of full-day short volume
--                            (%), null for US or pre-AM-publication
--
-- All nullable; pre-0013 rows stay valid. Populated by `sync-squeeze`,
-- which runs after `sync-analytics` (price history fresh) and
-- `sync-shorts` (short-interest + AM fresh). See `docs/SQUEEZE.md` for
-- the full formula + regime bands.
--
-- Idempotent: re-runnable on databases that already have these columns.
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists squeeze_score          numeric(5,2),
  add column if not exists squeeze_dtc            numeric(6,2),
  add column if not exists squeeze_si_chg_1w      numeric(8,4),
  add column if not exists squeeze_drawdown_30d   numeric(8,6),
  add column if not exists squeeze_volume_spike   numeric(6,2),
  add column if not exists squeeze_am_ratio       numeric(5,2);

-- Speed up "top squeeze candidates" queries against the latest as_of_date.
-- Partial index because the screener only ever sorts by squeeze_score
-- against the most-recent row per stock — historical squeeze snapshots
-- stay untouched.
create index if not exists idx_ey_stock_analytics_squeeze_score
  on public.ey_stock_analytics (as_of_date desc, squeeze_score desc)
  where squeeze_score is not null;