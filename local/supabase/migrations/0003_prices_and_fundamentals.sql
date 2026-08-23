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
