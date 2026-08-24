-- ============================================================================
-- EyesInvest — Phase 6: extend ey_short_* tables to accept HKEX/SFC rows
--
-- Migration 0005 created ey_short_sale_1d and ey_short_interest with a
-- `market text not null` column reserved for HKEX forward-compat but kept the
-- upstream worker (workers/yfinance/) gated on `market = 'US'`. This migration
-- does the table-side housekeeping to receive the first HK rows:
--
--   - Adds per-(stock_id, market) covering indexes so the existing PK
--     queries stay fast once both markets coexist in the same table.
--   - Adds a market-first secondary index for any future market-wide
--     aggregate queries ("short-selling aggregate per HK trading day").
--
-- No `ALTER TABLE` for `market` — the column is already `text` and accepts
-- any value; the worker simply starts writing `'HK'` rows. RLS policies
-- from 0005 (public read / service-role write) cover both markets.
-- ============================================================================

create index if not exists ey_short_sale_1d_stock_market_date_idx
  on public.ey_short_sale_1d (stock_id, market, trade_date desc);

create index if not exists ey_short_sale_1d_market_date_idx
  on public.ey_short_sale_1d (market, trade_date desc);

create index if not exists ey_short_interest_stock_market_settlement_idx
  on public.ey_short_interest (stock_id, market, settlement_date desc);

create index if not exists ey_short_interest_market_settlement_idx
  on public.ey_short_interest (market, settlement_date desc);
