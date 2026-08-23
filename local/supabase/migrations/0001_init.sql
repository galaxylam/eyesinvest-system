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
