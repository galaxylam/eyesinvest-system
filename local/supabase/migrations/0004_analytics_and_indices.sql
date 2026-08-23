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
