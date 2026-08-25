-- ============================================================================
-- EyesInvest — Phase 1 initial schema
--
-- Creates the ey_* tables required for Phase 1:
--   ey_markets, ey_currencies, ey_stocks, ey_stock_aliases
--
-- All new application resources must use the ey_ prefix.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ===== Reference: markets =====
create table if not exists public.ey_markets (
  code          text primary key,                 -- 'US' | 'HK'
  name_en       text not null,
  name_zh_hk    text not null,
  name_zh_cn    text not null,
  timezone      text not null,                    -- 'America/New_York', 'Asia/Hong_Kong'
  open_time     time not null,
  close_time    time not null,
  created_at    timestamptz not null default now()
);

-- ===== Reference: currencies =====
create table if not exists public.ey_currencies (
  code          text primary key,                 -- 'USD' | 'HKD' | 'CNY'
  symbol        text not null,                    -- 'US$', 'HK$', '¥'
  decimals      smallint not null default 2,
  created_at    timestamptz not null default now()
);

-- ===== Core: stocks =====
create table if not exists public.ey_stocks (
  id              uuid primary key default gen_random_uuid(),
  symbol          text not null,
  name            text not null,
  market          text not null references public.ey_markets(code),
  currency        text not null references public.ey_currencies(code),
  isin            text,
  exchange        text,                            -- 'NASDAQ', 'NYSE', 'HKEX'
  sector          text,
  industry        text,
  is_active       boolean not null default true,
  listed_at       date,
  delisted_at     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (symbol, market)
);

create index if not exists ey_stocks_market_active_idx
  on public.ey_stocks (market, is_active);

create index if not exists ey_stocks_symbol_idx
  on public.ey_stocks (symbol);

create index if not exists ey_stocks_name_trgm_idx
  on public.ey_stocks using gin (name gin_trgm_ops);

-- ===== Aliases =====
create table if not exists public.ey_stock_aliases (
  id              uuid primary key default gen_random_uuid(),
  stock_id        uuid not null references public.ey_stocks(id) on delete cascade,
  alias           text not null,
  locale          text,                            -- 'en' | 'zh-HK' | 'zh-CN' | null (universal)
  source          text,                            -- 'manual' | 'import' | 'provider'
  created_at      timestamptz not null default now(),
  unique (alias, stock_id)
);

create index if not exists ey_stock_aliases_stock_idx
  on public.ey_stock_aliases (stock_id);

create index if not exists ey_stock_aliases_alias_trgm_idx
  on public.ey_stock_aliases using gin (alias gin_trgm_ops);

-- ===== updated_at trigger =====
create or replace function public.ey_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ey_stocks_updated_at
  before update on public.ey_stocks
  for each row execute function public.ey_set_updated_at();

-- ===== Comment on schema =====
comment on schema public is 'EyesInvest — all application tables prefixed ey_*';
-- ============================================================================
-- EyesInvest — Phase 1 RLS policies
--
-- Phase 1 tables are read-public (anon + authenticated). Writes are blocked
-- for those roles and only happen through the admin app's service-role
-- client (which bypasses RLS by design).
--
-- Later phases (e.g. AI pending-review data) will add more restrictive
-- policies. Do NOT relax these without a security review.
--
-- Idempotent: drop policy if exists before create, so setup.sql is safe
-- to re-run on a database that already has these policies.
-- ============================================================================

alter table public.ey_stocks         enable row level security;
alter table public.ey_stock_aliases  enable row level security;
alter table public.ey_markets        enable row level security;
alter table public.ey_currencies     enable row level security;

-- ===== Public read =====
drop policy if exists "stocks_public_read"        on public.ey_stocks;
create policy "stocks_public_read"
  on public.ey_stocks for select
  using (true);

drop policy if exists "stock_aliases_public_read" on public.ey_stock_aliases;
create policy "stock_aliases_public_read"
  on public.ey_stock_aliases for select
  using (true);

drop policy if exists "markets_public_read"       on public.ey_markets;
create policy "markets_public_read"
  on public.ey_markets for select
  using (true);

drop policy if exists "currencies_public_read"    on public.ey_currencies;
create policy "currencies_public_read"
  on public.ey_currencies for select
  using (true);

-- ===== Writes blocked =====
-- We intentionally do NOT add insert/update/delete policies for the
-- anon/authenticated roles. With RLS enabled and no policy, those
-- operations are denied by default. Mutations go through the admin app's
-- service-role client (createAdminClient) which bypasses RLS.
-- ============================================================================
-- EyesInvest — Phase 2 schema: prices, quote snapshot, fundamentals
--
-- New tables:
--   ey_price_1d        — daily OHLC bars, append-only history (RLS public-read)
--   ey_quote_snapshot  — latest per-stock snapshot for dashboard / header
-- New columns on ey_stocks: market_cap, shares_outstanding, pe_ratio,
--   dividend_yield, fifty_two_week_high, fifty_two_week_low,
--   fundamentals_source, fundamentals_fetched_at
-- ============================================================================

-- ===== Daily OHLC =====
create table if not exists public.ey_price_1d (
  stock_id    uuid          not null references public.ey_stocks(id) on delete cascade,
  trade_date  date          not null,
  open        numeric(18,6) not null,
  high        numeric(18,6) not null,
  low         numeric(18,6) not null,
  close       numeric(18,6) not null,
  volume      bigint        not null default 0,
  currency    text          not null,
  source      text          not null default 'yfinance',
  fetched_at  timestamptz   not null default now(),
  primary key (stock_id, trade_date)
);

create index if not exists ey_price_1d_stock_date_idx
  on public.ey_price_1d (stock_id, trade_date desc);

create index if not exists ey_price_1d_date_idx
  on public.ey_price_1d (trade_date desc);

-- ===== Latest per-stock quote snapshot =====
create table if not exists public.ey_quote_snapshot (
  stock_id        uuid          primary key references public.ey_stocks(id) on delete cascade,
  last_price      numeric(18,6) not null,
  previous_close  numeric(18,6) not null,
  change          numeric(18,6) generated always as (last_price - previous_close) stored,
  change_percent  numeric(10,4) generated always as (
                    case
                      when previous_close = 0 then 0
                      else (last_price - previous_close) / previous_close * 100
                    end
                  ) stored,
  volume          bigint        not null default 0,
  as_of           date          not null,
  source          text          not null default 'yfinance',
  fetched_at      timestamptz   not null default now()
);

create index if not exists ey_quote_snapshot_change_pct_idx
  on public.ey_quote_snapshot (change_percent desc);

-- ===== Fundamentals on ey_stocks =====
alter table public.ey_stocks
  add column if not exists market_cap             bigint,
  add column if not exists shares_outstanding     bigint,
  add column if not exists pe_ratio               numeric(10,4),
  add column if not exists dividend_yield         numeric(10,6),
  add column if not exists fifty_two_week_high    numeric(18,6),
  add column if not exists fifty_two_week_low     numeric(18,6),
  add column if not exists fundamentals_source    text,
  add column if not exists fundamentals_fetched_at timestamptz;

-- ===== View: top movers =====
-- For each market, latest change_percent per stock, ordered by absolute value.
create or replace view public.ey_v_top_movers as
with latest as (
  select distinct on (qs.stock_id)
    qs.stock_id,
    qs.last_price,
    qs.previous_close,
    qs.change_percent,
    qs.as_of
  from public.ey_quote_snapshot qs
  order by qs.stock_id, qs.as_of desc
)
select
  s.id,
  s.symbol,
  s.name,
  s.market,
  s.currency,
  l.last_price,
  l.previous_close,
  l.change_percent,
  l.as_of
from public.ey_stocks s
join latest l on l.stock_id = s.id
where s.is_active = true
order by abs(coalesce(l.change_percent, 0)) desc, s.symbol asc;

-- ===== RLS for new tables =====
alter table public.ey_price_1d       enable row level security;
alter table public.ey_quote_snapshot enable row level security;

drop policy if exists "price_1d_public_read"        on public.ey_price_1d;
create policy "price_1d_public_read"
  on public.ey_price_1d for select
  using (true);

drop policy if exists "quote_snapshot_public_read"  on public.ey_quote_snapshot;
create policy "quote_snapshot_public_read"
  on public.ey_quote_snapshot for select
  using (true);

-- View inherits RLS from base tables — no separate policy needed.
grant select on public.ey_v_top_movers to anon, authenticated;
-- ============================================================================
-- EyesInvest — Phase 3 schema: analytics + index quotes
--
-- New tables:
--   ey_stock_analytics — per-stock, per-day computed indicators (MA / RSI /
--                        MACD / volatility / returns)
--   ey_index_quote    — daily latest for market indices (S&P 500 / HSI)
-- ============================================================================

-- ===== Per-stock, per-day analytics =====
create table if not exists public.ey_stock_analytics (
  stock_id            uuid        not null references public.ey_stocks(id) on delete cascade,
  as_of_date          date        not null,

  -- Moving averages (close-based)
  ma20                numeric(18,6),
  ma50                numeric(18,6),
  ma200               numeric(18,6),

  -- RSI(14) — 0..100
  rsi14               numeric(8,4),

  -- MACD(12, 26, 9)
  macd_line           numeric(18,6),
  macd_signal         numeric(18,6),
  macd_hist           numeric(18,6),

  -- 30-day annualized volatility (close-to-close, stdev of log returns × sqrt(252))
  volatility_30d      numeric(10,6),

  -- 30-day max drawdown (peak-to-trough), as negative fraction (e.g. -0.12 = -12%)
  max_drawdown_30d    numeric(10,6),

  -- Trailing returns over calendar windows (close / close - 1)
  return_1m           numeric(10,6),
  return_3m           numeric(10,6),
  return_6m           numeric(10,6),
  return_1y           numeric(10,6),

  source              text        not null default 'worker',
  computed_at         timestamptz not null default now(),

  primary key (stock_id, as_of_date)
);

create index if not exists ey_stock_analytics_date_idx
  on public.ey_stock_analytics (as_of_date desc);

-- ===== Daily latest for market indices =====
create table if not exists public.ey_index_quote (
  code               text        primary key,   -- 'SPX' | 'HSI'
  market             text        not null,      -- 'US' | 'HK'
  name_en            text        not null,
  name_zh_hk         text        not null,
  name_zh_cn         text        not null,
  last               numeric(18,6) not null,
  previous_close     numeric(18,6) not null,
  change             numeric(18,6) generated always as (last - previous_close) stored,
  change_percent     numeric(10,4) generated always as (
                       case when previous_close = 0 then 0
                            else (last - previous_close) / previous_close * 100 end
                     ) stored,
  as_of              date        not null,
  source             text        not null default 'yfinance',
  fetched_at         timestamptz not null default now()
);

-- ===== RLS =====
alter table public.ey_stock_analytics enable row level security;
alter table public.ey_index_quote     enable row level security;

drop policy if exists "stock_analytics_public_read" on public.ey_stock_analytics;
create policy "stock_analytics_public_read"
  on public.ey_stock_analytics for select
  using (true);

drop policy if exists "index_quote_public_read"     on public.ey_index_quote;
create policy "index_quote_public_read"
  on public.ey_index_quote for select
  using (true);

-- ===== Seed index reference rows =====
insert into public.ey_index_quote (code, market, name_en, name_zh_hk, name_zh_cn, last, previous_close, as_of)
values
  ('SPX', 'US', 'S&P 500', '標普500', '标普500', 0, 0, '1970-01-01'),
  ('HSI', 'HK', 'Hang Seng Index', '恒生指數', '恒生指数', 0, 0, '1970-01-01')
on conflict (code) do nothing;
-- ============================================================================
-- EyesInvest — Phase 5 schema: FINRA short-selling
--
-- New tables:
--   ey_short_sale_1d   — daily Reg-SHO short sale volume (T+1), US-only
--   ey_short_interest  — bi-weekly FINRA short interest (positions outstanding),
--                        US-only
--
-- The worker pulls these from FINRA's free, no-auth TXT endpoints:
--   daily:        http://regsho.finra.org/CNMSshvol{YYYYMMDD}.txt
--   bi-weekly:    https://www.finra.org/finra-data/short-interest (URL verified
--                 in the worker; see providers/shorts.py)
--
-- HK stocks short-circuit to NULL upstream — no ey_* rows are ever written for
-- HK tickers. The `market` column is kept for forward-compat with HKEX data.
-- ============================================================================

-- ===== Daily short sale volume (Reg-SHO) =====
create table if not exists public.ey_short_sale_1d (
  stock_id            uuid    not null references public.ey_stocks(id) on delete cascade,
  trade_date          date    not null,
  market              text    not null,
  short_volume        bigint  not null,
  short_exempt_volume bigint  not null default 0,
  total_volume        bigint  not null,
  short_value_hkd     numeric(18,6), -- reserved for future HK work, NULL for US
  source              text    not null default 'finra',
  fetched_at          timestamptz not null default now(),
  primary key (stock_id, trade_date)
);

create index if not exists ey_short_sale_1d_date_idx
  on public.ey_short_sale_1d (trade_date desc);
create index if not exists ey_short_sale_1d_stock_date_idx
  on public.ey_short_sale_1d (stock_id, trade_date desc);

-- ===== Bi-weekly short interest (positions outstanding) =====
create table if not exists public.ey_short_interest (
  stock_id              uuid    not null references public.ey_stocks(id) on delete cascade,
  settlement_date       date    not null,
  market                text    not null,
  short_interest        bigint  not null,
  days_to_cover         numeric(10,4),
  prior_short_interest  bigint,
  change_pct            numeric(10,4),
  source                text    not null default 'finra',
  fetched_at            timestamptz not null default now(),
  primary key (stock_id, settlement_date)
);

create index if not exists ey_short_interest_settlement_idx
  on public.ey_short_interest (settlement_date desc);
create index if not exists ey_short_interest_stock_settlement_idx
  on public.ey_short_interest (stock_id, settlement_date desc);

-- ===== RLS — public read, service-role writes =====
alter table public.ey_short_sale_1d  enable row level security;
alter table public.ey_short_interest enable row level security;

drop policy if exists "short_sale_1d_public_read" on public.ey_short_sale_1d;
create policy "short_sale_1d_public_read"
  on public.ey_short_sale_1d for select using (true);

drop policy if exists "short_interest_public_read" on public.ey_short_interest;
create policy "short_interest_public_read"
  on public.ey_short_interest for select using (true);
-- ============================================================================
-- EyesInvest — Phase 3+ sector strength
--
-- Adds per-stock metrics to `ey_stock_analytics`:
--   volume_efficiency   — |changePct| / (volume / sharesOutstanding × 100) for latest day
--   crowded_ratio       — MA5(volume) / MA30(volume) for latest day
--   relative_strength   — return_N(stock) − return_N(market) for the stock's market
--
-- Creates `ey_sector_daily` — one row per (sector, as_of_date) with sector-aggregated
-- breadth, equal-weight returns, RS vs global market, mean efficiency, mean crowded ratio.
--
-- Idempotent: re-runnable on databases that already have these objects.
-- ============================================================================

-- ===== Add columns to ey_stock_analytics =====
alter table public.ey_stock_analytics
  add column if not exists volume_efficiency   numeric(18,6),
  add column if not exists crowded_ratio       numeric(10,6),
  add column if not exists relative_strength   numeric(18,6);

-- ===== Per-sector, per-day aggregates =====
create table if not exists public.ey_sector_daily (
  sector                 text        not null,                    -- e.g. 'Financial Services'
  as_of_date             date        not null,

  -- Constituents
  member_count           smallint    not null,

  -- Equal-weight trailing returns, percent (matches ey_stock_analytics scale)
  sector_return_1m       numeric(10,6),
  sector_return_3m       numeric(10,6),
  sector_return_6m       numeric(10,6),
  sector_return_1y       numeric(10,6),

  -- Sector vs global market benchmark (sector return − mean(SPX, HSI) return), percent points
  rs_vs_market_1m        numeric(10,6),
  rs_vs_market_3m        numeric(10,6),
  rs_vs_market_6m        numeric(10,6),
  rs_vs_market_1y        numeric(10,6),

  -- Breadth: % of constituents with positive return_1m (percent, 0..100)
  breadth_pct            numeric(5,2),

  -- Means across members
  volume_efficiency_mean numeric(18,6),
  crowded_ratio_mean     numeric(10,6),

  source                 text        not null default 'worker',
  computed_at            timestamptz not null default now(),

  primary key (sector, as_of_date)
);

-- Index for the "latest snapshot across all sectors" dashboard path.
create index if not exists ey_sector_daily_date_idx
  on public.ey_sector_daily (as_of_date desc);

-- ===== RLS — public read, service-role writes =====
alter table public.ey_sector_daily enable row level security;

drop policy if exists "sector_daily_public_read" on public.ey_sector_daily;
create policy "sector_daily_public_read"
  on public.ey_sector_daily for select
  using (true);

-- No new policies needed on ey_stock_analytics — the existing
-- "stock_analytics_public_read" from 0004 covers the 3 new columns automatically.

-- ============================================================================
-- Phase 3+ sector strength (1-week window) — see 0009_sector_strength_1w.sql
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists return_1w numeric(10,6);

alter table public.ey_sector_daily
  add column if not exists sector_return_1w  numeric(10,6),
  add column if not exists rs_vs_market_1w   numeric(10,6);

-- ============================================================================
-- Phase 3+ add MA5 to stock analytics — see 0010_add_ma5.sql
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists ma5 numeric(18,6);

-- ============================================================================
-- Phase 3+ screener filter inputs — see 0011_screener_filters.sql
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists ma5_slope                  numeric(18,6),
  add column if not exists ma20_slope                 numeric(18,6),
  add column if not exists green_red_volume_ratio_1m numeric(18,6);

-- ============================================================================
-- Phase 3+ HKEX morning-session short-selling turnover — see 0012_hkex_am_short_selling.sql
-- ============================================================================

alter table public.ey_short_sale_1d
  add column if not exists am_short_volume     bigint,
  add column if not exists am_short_value_hkd  numeric(18,6),
  add column if not exists am_published_at     timestamptz;

-- ============================================================================
-- Phase 3+ short-squeeze score — see 0013_short_squeeze.sql
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists squeeze_score          numeric(5,2),
  add column if not exists squeeze_dtc            numeric(6,2),
  add column if not exists squeeze_si_chg_1w      numeric(8,4),
  add column if not exists squeeze_drawdown_30d   numeric(8,6),
  add column if not exists squeeze_volume_spike   numeric(6,2),
  add column if not exists squeeze_am_ratio       numeric(5,2);

-- ============================================================================
-- Phase 3+ green/red volume share (1M) — see 0014_green_red_volume_share.sql
-- ============================================================================

alter table public.ey_stock_analytics
  add column if not exists green_red_volume_share_1m numeric(6,4);

create index if not exists idx_ey_stock_analytics_squeeze_score
  on public.ey_stock_analytics (as_of_date desc, squeeze_score desc)
  where squeeze_score is not null;

-- ============================================================================
-- Phase 3+ symbol/market/currency invariant — see 0015_ey_stocks_symbol_market_match.sql
--
-- Forces `ey_stocks` rows to satisfy:
--   *.HK  ⇒  market='HK', currency='HKD'
--   else  ⇒  market='US', currency='USD'
--
-- Blocks any future direct-SQL insert that would silently bypass
-- `detectMarketCurrency` and break the HK path in `sync-shorts`.
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
-- ============================================================================
-- EyesInvest — Phase 1 seed data
--
-- Reference data: 2 markets, 3 currencies, 20 US + 10 HK stocks, with aliases
-- in English / Traditional Chinese / Simplified Chinese.
-- ============================================================================

-- ===== Markets =====
insert into public.ey_markets (code, name_en, name_zh_hk, name_zh_cn, timezone, open_time, close_time) values
  ('US', 'United States',  '美國',     '美国',    'America/New_York', '09:30', '16:00'),
  ('HK', 'Hong Kong',      '香港',     '香港',    'Asia/Hong_Kong',   '09:30', '16:00')
on conflict (code) do nothing;

-- ===== Currencies =====
insert into public.ey_currencies (code, symbol, decimals) values
  ('USD', 'US$', 2),
  ('HKD', 'HK$', 2),
  ('CNY', '¥',   2)
on conflict (code) do nothing;

-- ===== Stocks (US) =====
insert into public.ey_stocks (symbol, name, market, currency, exchange, sector, industry, is_active) values
  ('AAPL',  'Apple Inc.',                       'US', 'USD', 'NASDAQ', 'Technology',              'Consumer Electronics',        true),
  ('MSFT',  'Microsoft Corporation',            'US', 'USD', 'NASDAQ', 'Technology',              'Software',                    true),
  ('NVDA',  'NVIDIA Corporation',               'US', 'USD', 'NASDAQ', 'Technology',              'Semiconductors',              true),
  ('AMZN',  'Amazon.com Inc.',                  'US', 'USD', 'NASDAQ', 'Consumer Cyclical',       'Internet Retail',             true),
  ('GOOGL', 'Alphabet Inc.',                    'US', 'USD', 'NASDAQ', 'Communication Services',  'Internet Content',            true),
  ('META',  'Meta Platforms Inc.',              'US', 'USD', 'NASDAQ', 'Communication Services',  'Social Media',                true),
  ('TSLA',  'Tesla Inc.',                       'US', 'USD', 'NASDAQ', 'Consumer Cyclical',       'Auto Manufacturers',          true),
  ('JPM',   'JPMorgan Chase & Co.',             'US', 'USD', 'NYSE',   'Financial Services',      'Banks',                       true),
  ('BAC',   'Bank of America Corp.',            'US', 'USD', 'NYSE',   'Financial Services',      'Banks',                       true),
  ('XOM',   'Exxon Mobil Corporation',          'US', 'USD', 'NYSE',   'Energy',                  'Oil & Gas',                   true),
  ('CVX',   'Chevron Corporation',              'US', 'USD', 'NYSE',   'Energy',                  'Oil & Gas',                   true),
  ('WMT',   'Walmart Inc.',                     'US', 'USD', 'NYSE',   'Consumer Defensive',      'Discount Stores',             true),
  ('KO',    'The Coca-Cola Company',            'US', 'USD', 'NYSE',   'Consumer Defensive',      'Beverages',                   true),
  ('PEP',   'PepsiCo Inc.',                     'US', 'USD', 'NASDAQ', 'Consumer Defensive',      'Beverages',                   true),
  ('PFE',   'Pfizer Inc.',                      'US', 'USD', 'NYSE',   'Healthcare',              'Drug Manufacturers',          true),
  ('JNJ',   'Johnson & Johnson',                'US', 'USD', 'NYSE',   'Healthcare',              'Pharmaceutical',              true),
  ('V',     'Visa Inc.',                        'US', 'USD', 'NYSE',   'Financial Services',      'Credit Services',             true),
  ('MA',    'Mastercard Incorporated',          'US', 'USD', 'NYSE',   'Financial Services',      'Credit Services',             true),
  ('DIS',   'The Walt Disney Company',          'US', 'USD', 'NYSE',   'Communication Services',  'Entertainment',                true),
  ('NFLX',  'Netflix Inc.',                     'US', 'USD', 'NASDAQ', 'Communication Services',  'Entertainment',                true)
on conflict (symbol, market) do nothing;

-- ===== Stocks (HK) =====
insert into public.ey_stocks (symbol, name, market, currency, exchange, sector, industry, is_active) values
  ('0700.HK', 'Tencent Holdings Ltd.',                  'HK', 'HKD', 'HKEX', 'Communication Services', 'Internet Content',                 true),
  ('9988.HK', 'Alibaba Group Holding Ltd.',             'HK', 'HKD', 'HKEX', 'Consumer Cyclical',      'Internet Retail',                  true),
  ('0005.HK', 'HSBC Holdings plc',                      'HK', 'HKD', 'HKEX', 'Financial Services',     'Banks',                            true),
  ('0941.HK', 'China Mobile Limited',                   'HK', 'HKD', 'HKEX', 'Communication Services', 'Telecom',                          true),
  ('1299.HK', 'AIA Group Limited',                      'HK', 'HKD', 'HKEX', 'Financial Services',     'Insurance',                        true),
  ('0883.HK', 'CNOOC Limited',                          'HK', 'HKD', 'HKEX', 'Energy',                 'Oil & Gas',                        true),
  ('0388.HK', 'Hong Kong Exchanges & Clearing',          'HK', 'HKD', 'HKEX', 'Financial Services',     'Financial Data & Stock Exchanges', true),
  ('2318.HK', 'Ping An Insurance Group',                'HK', 'HKD', 'HKEX', 'Financial Services',     'Insurance',                        true),
  ('3690.HK', 'Meituan',                                'HK', 'HKD', 'HKEX', 'Consumer Cyclical',      'Internet Retail',                  true),
  ('1810.HK', 'Xiaomi Corporation',                     'HK', 'HKD', 'HKEX', 'Technology',             'Consumer Electronics',             true)
on conflict (symbol, market) do nothing;

-- ===== Aliases =====
-- English (universal)
insert into public.ey_stock_aliases (stock_id, alias, locale, source)
select s.id, x.alias, l.locale, 'seed'
from public.ey_stocks s
join (values
  ('AAPL', 'Apple'),
  ('AAPL', 'Apple Inc'),
  ('MSFT', 'Microsoft'),
  ('NVDA', 'NVIDIA'),
  ('AMZN', 'Amazon'),
  ('GOOGL', 'Google'),
  ('GOOGL', 'Alphabet'),
  ('META', 'Facebook'),
  ('TSLA', 'Tesla'),
  ('JPM',  'JPMorgan'),
  ('BAC',  'Bank of America'),
  ('XOM',  'Exxon'),
  ('CVX',  'Chevron'),
  ('WMT',  'Walmart'),
  ('KO',   'Coca-Cola'),
  ('PEP',  'Pepsi'),
  ('PFE',  'Pfizer'),
  ('JNJ',  'Johnson & Johnson'),
  ('V',    'Visa'),
  ('MA',   'Mastercard'),
  ('DIS',  'Disney'),
  ('NFLX', 'Netflix'),
  ('0700.HK', 'Tencent'),
  ('9988.HK', 'Alibaba'),
  ('0005.HK', 'HSBC'),
  ('0941.HK', 'China Mobile'),
  ('1299.HK', 'AIA'),
  ('0883.HK', 'CNOOC'),
  ('0388.HK', 'HKEX'),
  ('2318.HK', 'Ping An'),
  ('3690.HK', 'Meituan'),
  ('1810.HK', 'Xiaomi')
) as x(symbol, alias) on s.symbol = x.symbol
cross join lateral (values ('en'::text)) as l(locale)
on conflict do nothing;

-- Traditional Chinese
insert into public.ey_stock_aliases (stock_id, alias, locale, source)
select s.id, x.alias, 'zh-HK', 'seed'
from public.ey_stocks s
join (values
  ('AAPL',  '蘋果'),
  ('MSFT',  '微軟'),
  ('NVDA',  '輝達'),
  ('AMZN',  '亞馬遜'),
  ('GOOGL', '谷歌'),
  ('META',  '臉書'),
  ('TSLA',  '特斯拉'),
  ('JPM',   '摩根大通'),
  ('BAC',   '美國銀行'),
  ('WMT',   '沃爾瑪'),
  ('KO',    '可口可樂'),
  ('PFE',   '輝瑞'),
  ('JNJ',   '強生'),
  ('DIS',   '迪士尼'),
  ('NFLX',  '網飛'),
  ('0700.HK', '騰訊'),
  ('0700.HK', '騰訊控股'),
  ('9988.HK', '阿里巴巴'),
  ('0005.HK', '匯豐'),
  ('0941.HK', '中國移動'),
  ('1299.HK', '友邦保險'),
  ('0883.HK', '中海油'),
  ('0388.HK', '港交所'),
  ('0388.HK', '香港交易所'),
  ('2318.HK', '中國平安'),
  ('2318.HK', '平安'),
  ('3690.HK', '美團'),
  ('1810.HK', '小米')
) as x(symbol, alias) on s.symbol = x.symbol
on conflict do nothing;

-- Simplified Chinese
insert into public.ey_stock_aliases (stock_id, alias, locale, source)
select s.id, x.alias, 'zh-CN', 'seed'
from public.ey_stocks s
join (values
  ('AAPL',  '苹果'),
  ('MSFT',  '微软'),
  ('NVDA',  '英伟达'),
  ('AMZN',  '亚马逊'),
  ('GOOGL', '谷歌'),
  ('META',  '脸书'),
  ('TSLA',  '特斯拉'),
  ('JPM',   '摩根大通'),
  ('BAC',   '美国银行'),
  ('WMT',   '沃尔玛'),
  ('KO',    '可口可乐'),
  ('PFE',   '辉瑞'),
  ('JNJ',   '强生'),
  ('DIS',   '迪士尼'),
  ('NFLX',  '网飞'),
  ('0700.HK', '腾讯'),
  ('0700.HK', '腾讯控股'),
  ('9988.HK', '阿里巴巴'),
  ('0005.HK', '汇丰'),
  ('0941.HK', '中国移动'),
  ('1299.HK', '友邦保险'),
  ('0883.HK', '中海油'),
  ('0388.HK', '港交所'),
  ('0388.HK', '香港交易所'),
  ('2318.HK', '中国平安'),
  ('2318.HK', '平安'),
  ('3690.HK', '美团'),
  ('1810.HK', '小米')
) as x(symbol, alias) on s.symbol = x.symbol
on conflict do nothing;
