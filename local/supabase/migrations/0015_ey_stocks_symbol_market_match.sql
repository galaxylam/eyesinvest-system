-- ============================================================================
-- EyesInvest — Symbol ↔ Market ↔ Currency invariant on ey_stocks
--
-- Prevents the data integrity bug where `.HK` symbols were inserted with
-- `market='US', currency='USD'`, which silently bypassed the HK path in
-- `sync-shorts` and made the SFC sync drop those tickers as "untracked
-- codes". The invariant is:
--
--   *.HK  ⇒  HK / HKD
--   else  ⇒  US / USD
--
-- Any future direct-SQL insert that violates this rule will fail with a
-- CHECK constraint violation rather than silently producing a broken
-- Short Selling chart for that ticker.
-- ============================================================================

alter table public.ey_stocks
  add constraint ey_stocks_symbol_market_currency_match
  check (
    (right(symbol, 3) = '.HK'
      and market = 'HK' and currency = 'HKD')
    or
    (right(symbol, 3) <> '.HK'
      and market = 'US' and currency = 'USD')
  );