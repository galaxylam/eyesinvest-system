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