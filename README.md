# EyesInvest

Professional investment-analysis platform covering US and Hong Kong equities.
Built as a Next.js monorepo with a local Python analytics engine, Supabase
shared data layer, and dark-first UI supporting English / Traditional Chinese
(繁體) / Simplified Chinese (简体).

> **Status:** Phase 3 — Analytics + Phase 7 (news ingestion) + Phase 8 (AI analysis).
> Phase 1 shipped the foundation: bilingual public site, admin CRUD, Supabase
> schema. Phase 2 added daily OHLC + quote snapshots via a Python yfinance
> worker (real prices on stock detail and dashboard Top Movers). Phase 3
> adds computed technical indicators (MA / RSI / MACD / volatility / returns)
> and reference index quotes (SPX, HSI) on every stock detail page and the
> dashboard Market Summary tiles. Phase 7 + 8 ship `sync-news` (RSS → OpenRouter
> analysis → pending rows for admin approval via `apps/admin/news` +
> `/relationships`). Deployment to Vercel is in place; real-time streaming,
> sector-level relative strength, and public user accounts remain deferred.

---

## Repository layout

```
eyesinvest-system/
├── apps/
│   ├── web/      Next.js public site (http://localhost:3000)
│   └── admin/    Next.js local admin app (http://localhost:3001)
├── packages/
│   ├── config/   Shared tsconfig / eslint / tailwind preset
│   ├── types/    Shared TypeScript types (incl. Supabase generated types)
│   ├── i18n/     Canonical translation files (en / zh-HK / zh-CN)
│   └── ui/       shadcn-style UI primitives
├── workers/
│   └── yfinance/ Python worker (uv + Python 3.12) — Phase 2 market data sync
└── local/
    └── supabase/
        ├── config.toml          (optional — only if you run supabase start locally)
        ├── migrations/          Plain SQL (ey_* tables) — applies to hosted or local
        ├── seed.sql             Reference data — apply after migrations
        └── setup.sql            One-shot combined script (schema + RLS + seed)
```

## Prerequisites

- Node.js 20+
- pnpm 10+
- (Optional, for live Supabase data) A Supabase project — either [supabase.com](https://supabase.com) (hosted) or local via Docker + Supabase CLI
- (Optional, for live market data) [uv](https://docs.astral.sh/uv/) + Python 3.12 (the yfinance worker)
- (Optional, for E2E) Playwright browsers

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up env files (Phase 1: app works against bundled mock data, no env required)
cp .env.example apps/web/.env.local
cp .env.example apps/admin/.env.local

# 3. Run both apps
pnpm dev
```

Then open:

- Public site: <http://localhost:3000>
- Local admin:  <http://localhost:3001>

## Connecting to a Supabase project (hosted or local)

The apps are Supabase-agnostic: they read every endpoint from
`NEXT_PUBLIC_SUPABASE_URL`. `local/supabase/` ships plain SQL, so the same
files apply to either a hosted supabase.com project or a local CLI stack.

### Option A — Hosted Supabase (supabase.com)

1. Create / open your project in the Supabase dashboard.
2. Grab from **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (admin app only)
3. Apply the schema + RLS + seed in **one go** by pasting the contents of
   `local/supabase/setup.sql` into the dashboard **SQL Editor** and clicking
   Run. (setup.sql is `0001_init.sql` + `0002_rls.sql` + `seed.sql`
   concatenated, so you can't accidentally run them out of order.)
   - If you already ran `seed.sql` without the migrations, you'll see
     `relation "public.ey_markets" does not exist`. Run `setup.sql` from
     the top — the seed is `on conflict do nothing` so duplicate inserts
     are safe.
4. Drop the values into `apps/web/.env.local` and `apps/admin/.env.local`.
   Restart `pnpm dev` — the data layer auto-switches from mock to live.

### Option B — Local Supabase CLI (optional)

If you ever want to mirror locally: `cd local/supabase && supabase start`
boots a stack matching `config.toml` on ports 54321/54322/54323, then
`supabase db reset` applies migrations + seed. The apps pick it up via
`http://127.0.0.1:54321`. Not required if you're on a hosted project.

## Phase 7 + 8 deliverable map

| Feature | Where |
|---|---|
| News tables (article + 2 AI tables) + RLS | `local/supabase/migrations/0016_news_and_ai.sql` |
| News + AI TS types | `packages/types/src/{newsArticle,aiMapping}.ts` |
| Worker `sync-news` (RSS + OpenRouter) | `workers/yfinance/src/eyesinvest_worker/providers/news.py` |
| News Pydantic models + db helpers | `workers/yfinance/src/eyesinvest_worker/{models,db/supabase}.py` |
| Worker config (`NEWS_*`, `OPENROUTER_*`) | `workers/yfinance/src/eyesinvest_worker/config.py` |
| Worker CLI subcommand + `sync_all` aggregator | `workers/yfinance/src/eyesinvest_worker/cli.py` |
| Worker tests (pure-Python) | `workers/yfinance/tests/test_news.py` |
| Admin news queue (list + review + actions) | `apps/admin/src/app/(authed)/news/{page.tsx,[id]/page.tsx,actions.ts}` |
| Admin relationships queue | `apps/admin/src/app/(authed)/relationships/{page.tsx,[id]/page.tsx,actions.ts}` |
| Admin queue components | `apps/admin/src/components/{NewsMappingQueueTable,NewsReviewForm,RelationshipQueueTable,RelationshipReviewForm}.tsx` |
| Admin queries + mock fallback | `apps/admin/src/lib/news/{admin-queries,mock-data}.ts` |
| Ops docs | `workers/yfinance/SYNC_NEWS.md` + `docs/OPERATIONS.md` Phase 7/8 sections |

## Phase 3 deliverable map

| Feature | Where |
|---|---|
| Analytics + index tables | `local/supabase/migrations/0004_analytics_and_indices.sql` |
| Indicator / index types | `packages/types/src/{stockAnalytics,indexQuote}.ts` |
| Worker analytics + indexes pass | `workers/yfinance/src/eyesinvest_worker/providers/{analytics,indexes}.py` |
| Stock AnalyticsPanel (MA / RSI / MACD / vol / returns) | `apps/web/src/components/stocks/AnalyticsPanel.tsx` |
| Dashboard Market Summary tiles (SPX, HSI) | `apps/web/src/app/[locale]/dashboard/page.tsx` |
| Phase 3 query functions | `apps/web/src/lib/stocks/queries.ts` (`getStockAnalytics`, `getIndexQuotes`) |
| i18n: indicator labels + index tile subtitles | `packages/i18n/locales/*.json` + `apps/web/messages/*.json` |

## Phase 2 deliverable map

| Feature | Where |
|---|---|
| Daily OHLC + quote snapshot | `local/supabase/migrations/0003_prices_and_fundamentals.sql` |
| yfinance Python worker | `workers/yfinance/` |
| Real-time price chart | `apps/web/src/components/stocks/PriceChart.tsx` |
| Stock header with quote | `apps/web/src/components/stocks/StockHeader.tsx` |
| Key stats (market cap, P/E, 52-wk range) | `apps/web/src/components/stocks/KeyStats.tsx` |
| Dashboard Top Movers | `apps/web/src/app/[locale]/dashboard/page.tsx` |
| Phase 2 query functions | `apps/web/src/lib/stocks/queries.ts` |
| Mock fallback (synthetic OHLC, deterministic per symbol) | `apps/web/src/lib/stocks/mock-data.ts` |

## Running the yfinance worker

### Scheduled (recommended) — GitHub Actions

`.github/workflows/sync.yml` runs both markets daily, no local setup:

| Market | Cron (UTC) | Local time |
|---|---|---|
| US | `30 21 * * 1-5` | 16:30 ET (EST) / 17:30 ET (EDT), weekdays |
| HK | `0 1 * * 2-6` | 09:00 HKT Mon–Fri (Tue–Sat UTC) |

Required GitHub repo secrets (Settings → Secrets and variables → Actions):

| Secret | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service_role JWT (worker bypasses RLS) |
| `OPENROUTER_API_KEY` | no | enables `sync-news` LLM pass |
| `FINRA_API_CLIENT_ID` / `FINRA_API_SECRET` | no | enables FINRA API path for `sync-shorts` |

You can also run it manually: Actions tab → "Sync market data" → Run workflow → pick `us` / `hk` / `all`. On failure the workflow opens a GitHub Issue labelled `sync-failure` — create that label once in your repo so the failure-issuance step doesn't no-op.

### Local (development / ad-hoc backfill)

```bash
# Install uv (one-time)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Configure worker
cd workers/yfinance
uv sync
cp .env.example .env                   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

# Run all syncs
cd ../..
pnpm worker:sync
# = uv run python -m eyesinvest_worker all

# Or run only one market end-to-end
pnpm worker:sync:us        # US stocks only
pnpm worker:sync:hk        # HK stocks only
#   - sync-prices       → ey_price_1d (2y daily OHLC)
#   - sync-quotes       → ey_quote_snapshot (latest close + change %)
#   - sync-fundamentals → ey_stocks (market cap, P/E, 52-wk range, ...)
#   - sync-analytics    → ey_stock_analytics (MA / RSI / MACD / vol / returns)
#   - sync-shorts       → ey_short_sale_1d + ey_short_interest
#   - sync-squeeze      → squeeze_score / DTC / SI chg / volume spike
#   - sync-indexes      → ey_index_quote (SPX, HSI)
#   - sync-sector-strength → ey_sector_daily
```

The local scripts are still wired up in `package.json` so you can backfill or
re-sync from your laptop without waiting for the cron. They just don't run on
a schedule any more.

## What's NOT in Phase 3 yet

Minute / intraday bars, Trigger.dev orchestration, real-time WebSocket
streaming, sector-level relative strength, volume efficiency / crowded
ratio metrics (only the green/red share is shipped), proprietary
rankings, Supabase Realtime streaming, public user accounts.

## Environment variables

All keys with placeholders are documented in `.env.example` at the repo root.
Phase 1 apps work against bundled mock data and do not require Supabase to be
running. To connect to real Supabase, set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/web/.env.local`, plus
`SUPABASE_SERVICE_ROLE_KEY` in `apps/admin/.env.local`.

The admin app ships **without login** in Phase 1 — it's bound to
`localhost:3001` only and is intended for local development. Real
`ey_admin_users` + session auth is deferred to a later phase.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start both apps in parallel via Turbo |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm e2e` | Run Playwright smoke test |
| `pnpm worker:sync` | Sync all market data via the yfinance worker |
| `pnpm worker:sync:us` | Sync US stocks only |
| `pnpm worker:sync:hk` | Sync HK stocks only |
| `pnpm clean` | Remove build artifacts |
