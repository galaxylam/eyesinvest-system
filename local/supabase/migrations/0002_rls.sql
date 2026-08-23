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
