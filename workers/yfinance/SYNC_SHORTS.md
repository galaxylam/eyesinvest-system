# `sync-shorts` — FINRA short-selling worker

Pulls US short-selling data from FINRA into the `ey_short_sale_1d` and
`ey_short_interest` Supabase tables. US-only — HK stocks are filtered
out upstream so the rest of the pipeline stays market-agnostic.

## What it does

| Dataset | FINRA field | Cadence | Table written |
|---|---|---|---|
| Daily FINRA short volume (`regShoDaily`) | `shortParQuantity` (already includes exempt), `shortExemptParQuantity`, `totalParQuantity` | T+1 daily | `ey_short_sale_1d` |
| Outstanding short positions (`consolidatedShortInterest`) | `currentShortPositionQuantity`, `previousShortPositionQuantity`, `changePercent`, `daysToCoverQuantity`, `averageDailyVolumeQuantity` | Bi-weekly (15th + last biz day of month) | `ey_short_interest` |

The daily short-volume ratio surfaced on the UI is **not** stored — it's
derived at query time as `short_volume / total_volume × 100` (summed
across reporting facilities NQTRF + NYTRF + ADF per `(ticker, date)`).

## Data sources

Two paths, in order of preference:

### 1. Authenticated FINRA Developer API (preferred)

- OAuth2 client-credentials grant → Bearer token cached 11h
- Token endpoint: `https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials`
- API base: `https://api.finra.org/data/group/otcMarket/name/{dataset}`
- One POST per ticker per dataset (keeps responses small, well under the
  5,000-row per-call cap)
- Daily sync throttle: 0.5 s between tickers (well under FINRA's
  1,200 req/min/IP rate cap)

Activate by setting both `FINRA_API_CLIENT_ID` and `FINRA_API_SECRET` in
`.env`. Obtain these from <https://developer.finra.org/>.

### 2. Public CDN fallback

- Daily: `https://cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt`
  (pipe-delimited, no auth)
- Bi-weekly: `https://cdn.finra.org/data/shortsale/biweekly.txt` — single
  "most recent release" TXT
- One HTTP request per trading day → Cloudflare 403/429 from datacenter
  IPs is the main failure mode (bi-weekly endpoint often blocks outright)
- Use this only when the Developer API isn't provisioned. Most runs hit
  the API path.

## Auth setup

1. Sign up at <https://developer.finra.org/> and create an OAuth app.
2. Copy the **Client ID** and **Client Secret** into `workers/yfinance/.env`:

   ```env
   FINRA_API_CLIENT_ID=...
   FINRA_API_SECRET=...
   ```

3. Verify the worker picks it up:

   ```bash
   uv run python -m eyesinvest_worker sync-shorts
   # → "using authenticated FINRA Developer API"
   ```

> **Security**: `FINRA_API_SECRET` must stay on the server side. Never
> expose it in `NEXT_PUBLIC_*` variables, browser code, mobile apps, or
> public repos. Rotate immediately if leaked.

## Schema

Both tables share the same pattern: `(stock_id, <date>)` primary key,
`on delete cascade` to `ey_stocks(id)`, `source text not null default 'finra'`,
RLS read-only.

```sql
create table public.ey_short_sale_1d (
  stock_id            uuid    not null references public.ey_stocks(id) on delete cascade,
  trade_date          date    not null,
  market              text    not null,
  short_volume        bigint  not null,
  short_exempt_volume bigint  not null default 0,
  total_volume        bigint  not null,
  short_value_hkd     numeric(18,6),   -- reserved for HK work, NULL for US
  source              text    not null default 'finra',
  fetched_at          timestamptz not null default now(),
  primary key (stock_id, trade_date)
);

create table public.ey_short_interest (
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
```

Migration: `local/supabase/migrations/0005_short_selling.sql`. Cleanup
script for purging CDN-sourced rows: `0006_clean_short_selling.sql`.

## CLI usage

```bash
# From workers/yfinance/:
uv run python -m eyesinvest_worker sync-shorts

# From repo root:
pnpm worker:shorts          # if a workspace script exists; otherwise:
cd workers/yfinance && uv run python -m eyesinvest_worker sync-shorts
```

Expected output on success (API path, 90-day window):

```
syncing FINRA short-selling for 20 US stocks
using authenticated FINRA Developer API
FINRA OAuth2 token acquired (cache 11h)
regShoDaily: 1260 aggregated daily rows
consolidatedShortInterest: 3839 settlement rows
upserted 1260 rows into ey_short_sale_1d
upserted 3839 rows into ey_short_interest
sync-shorts done — 1260 daily + 3839 bi-weekly rows
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Service-role key (write access) |
| `FINRA_API_CLIENT_ID` | no | unset | FINRA Developer app ID |
| `FINRA_API_SECRET` | no | unset | FINRA Developer app secret |
| `SHORT_SALE_HISTORY_DAYS` | no | 90 | Calendar days of `regShoDaily` per ticker (~63 trading days). Bump for longer daily bar history; 1 ticker × 365 days = ~252 rows, well under the 5,000-row per-call cap. |
| `PRICE_THROTTLE_SECONDS` | no | 0.5 | Pause between ticker fetches |

When `FINRA_API_CLIENT_ID` + `FINRA_API_SECRET` are both set, the worker
uses the authenticated API path. If either is missing, it falls back to
the public CDN.

## Throttling & errors

- **API path**: 0.5 s sleep between ticker requests. Stays well under
  FINRA's 1,200 req/min/IP cap.
- **Per-ticker failures are non-fatal**. Each ticker is wrapped in a
  try/except; failures log a warning and the run continues.
- **AMZN-class heavy tickers**: `consolidatedShortInterest` may time out
  on the 60 s socket timeout (AMZN's full history is large). The worker
  logs a warning and skips that ticker; re-running later will pick up
  any newly-published rows.
- **401 / token expiry**: the OAuth client re-fetches a fresh Bearer
  token on 401 and retries the request once.
- **Cloudflare 403/429** on the CDN path: logged + retried once with
  a 5 s back-off. Persistent failures fall back to "no rows for this date"
  rather than aborting the run.

## Known quirks

### `shortParQuantity` already includes short-exempt volume

Per the FINRA guide, do **not** compute:

```
shortParQuantity + shortExemptParQuantity
```

because `shortParQuantity` already contains the exempt volume. The
worker stores both columns separately; the UI can subtract if it wants
"regular short only" (we don't expose that today).

### Decimal volumes in 2025+ releases

Older CNMS files had integer share counts. From 2025 onward, FINRA
publishes fractional share counts (e.g. `261283.883609`) — likely
consolidated rounding. The worker's parser does `int(float(s))` so both
formats parse cleanly.

### Aggregation across reporting facilities

A single ticker/date can return 1–3 rows depending on which FINRA
facilities saw the trade (NQTRF, NYTRF, ADF). We **sum** these into a
single `(stock_id, trade_date)` row. The on-disk PK enforces dedup so
re-runs are idempotent.

### CNMS consolidation window

The consolidated CNMS file (`CNMSshvol*.txt`) starts **2018-08-01**. If
you need pre-2018 data, parse the FNSQ/FNYX files separately.

## Verification

```bash
# 1. Confirm rows landed
psql -d eyesinvest -c "select count(*) from ey_short_sale_1d"
psql -d eyesinvest -c "select count(*) from ey_short_interest"

# 2. Spot-check AAPL
psql -d eyesinvest -c "
  select trade_date, short_volume, total_volume,
         round((short_volume::numeric / total_volume) * 100, 2) as short_pct
  from ey_short_sale_1d
  where stock_id = (select id from ey_stocks where symbol = 'AAPL')
  order by trade_date desc limit 10;"

# 3. Visual check
# Open http://localhost:3000/en/stocks/AAPL — the 4th sub-chart should
# show ~63 daily bars (emerald/rose) + ~25 bi-weekly purple line points
# over a 3-month window, with four header pills.
```

## Out of scope

- **Short squeeze detector / squeeze scoring** — analytical layer on top
  of these tables, separate iteration.
- **Real-time intraday short volume** — FINRA publishes daily only.
- **Pre-2018 historical backfill** — outside the consolidated CNMS
  window.

## HK coverage

`sync-shorts` also writes short-selling data for HK-listed stocks:

- **Daily** short-sale turnover → HKEX public `ASHTMAIN.HTM` pages
  (Main Board + GEM), stored as `(market='HK', source='hkex')`.
- **Weekly** aggregated reportable short positions → SFC weekly CSVs
  (2012-09-14 → present), stored as `(market='HK', source='sfc')`.

See **`HK_SHORTS.md`** for endpoint patterns, env vars, cadence, the
unverified-parser caveat, and a step-by-step verification recipe.
