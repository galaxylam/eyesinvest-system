-- 0006_clean_short_selling.sql
-- Wipe any CDN-sourced (potentially inaccurate) rows from the FINRA tables
-- so the next `sync-shorts` run starts from a clean baseline sourced
-- exclusively from the authenticated FINRA Developer API (regShoDaily +
-- consolidatedShortInterest).
--
-- The API path is the source of truth going forward:
--   * regShoDaily: rows aggregated across reporting facilities (NQTRF +
--     NYTRF + ADF) per (ticker, date).  shortParQuantity already includes
--     short-exempt volume.
--   * consolidatedShortInterest: full bi-weekly settlement history per
--     ticker, with prior-period change %, days-to-cover, etc.
--
-- Idempotent: the two TRUNCATEs are no-ops once the tables are empty.
-- Safe to re-run.

truncate table public.ey_short_sale_1d   restart identity;
truncate table public.ey_short_interest  restart identity;