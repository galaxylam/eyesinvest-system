# EyesInvest — yfinance sync worker

Pulls daily OHLC bars, quote snapshots, fundamentals, technical analytics,
index quotes, and US short-selling data into Supabase. Each sync command
is independent so you can run them on different cadences.

## Prerequisites

- Python 3.12 (managed by [uv](https://docs.astral.sh/uv/))
- A Supabase project with the schema applied (run `local/supabase/setup.sql`
  in the dashboard SQL Editor)
- The service-role key from `Project Settings → API`

## Install

```bash
# Install uv if not already present (one-line installer)
curl -LsSf https://astral.sh/uv/install.sh | sh

# From repo root:
cd workers/yfinance
uv sync                                # creates .venv + installs deps
cp .env.example .env                   # then fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

## Run

```bash
# Single run — sync everything
uv run python -m eyesinvest_worker all

# Or step-by-step
uv run python -m eyesinvest_worker sync-prices
uv run python -m eyesinvest_worker sync-quotes
uv run python -m eyesinvest_worker sync-fundamentals
uv run python -m eyesinvest_worker sync-analytics
uv run python -m eyesinvest_worker sync-indexes
uv run python -m eyesinvest_worker sync-shorts   # see SYNC_SHORTS.md
uv run python -m eyesinvest_worker sync-sector-strength
```

Convenience from repo root: `pnpm worker:sync` (= `cd workers/yfinance && uv run python -m eyesinvest_worker all`).

## What it writes

| Command | Writes to | Notes |
|---|---|---|
| `sync-prices` | `ey_price_1d` | 2-year daily OHLC per active stock |
| `sync-quotes` | `ey_quote_snapshot` | Latest close + previous close + change % |
| `sync-fundamentals` | `ey_stocks` | `market_cap`, `pe_ratio`, `dividend_yield`, 52-wk range, etc. |
| `sync-analytics` | `ey_stock_analytics` | MA / RSI / MACD / volatility / drawdown / returns |
| `sync-indexes` | `ey_index_quote` | Latest SPX + HSI daily quotes |
| `sync-shorts` | `ey_short_sale_1d`, `ey_short_interest` | US FINRA + HK HKEX daily + SFC weekly (see `SYNC_SHORTS.md`, `HK_SHORTS.md`). HK rows additionally capture the HKEX morning-session turnover (`am_short_volume`, `am_short_value_hkd`, `am_published_at`) when the AM page is published around lunch break. |
| `sync-sector-strength` | `ey_stock_analytics`, `ey_sector_daily` | Phase 3+ — per-stock `volume_efficiency` / `crowded_ratio` / `relative_strength` + sector-level rollup. Refetches SPX + HSI trailing bars from yfinance (~2 calls) to compute market-relative returns. |
| `all` | all of the above | Sequential |

## Scheduling

Phase 2 v1 doesn't ship a scheduler. Recommended approaches:

- **Manual / on-demand** — run `pnpm worker:sync` whenever you want fresh data.
- **cron (Linux) / launchd (macOS)** — wrap the `uv run python -m eyesinvest_worker all` command. Suggested cadence: every 30–60 min during market hours, every 4–6h off-hours.
- **GitHub Actions** — schedule a workflow on a cron trigger (free for public repos). Secrets for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` go in repo secrets.

Trigger.dev orchestration is deferred to a later phase.

## Rate limits & errors

- yfinance rate-limits aggressively. The worker sleeps 0.5s between stocks
  and 1.0s between `.info` calls. Per-ticker failures are logged and
  skipped — one bad ticker never aborts the run.
- Network errors retry once after 5s. Repeated failures log a warning and
  continue.

## Fallback when worker hasn't run yet

The Next.js apps use the existing `withFallback` pattern — if `ey_quote_snapshot`
or `ey_price_1d` is empty, the page renders `—` placeholders + a synthetic
chart so the UI never breaks.
