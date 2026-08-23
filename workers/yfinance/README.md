# EyesInvest — yfinance sync worker

Pulls daily OHLC bars, quote snapshots, and fundamentals from Yahoo Finance
into Supabase. Phase 2 v1 ships daily bars only — minute bars are deferred.

## Prerequisites

- Python 3.12 (managed by [uv](https://docs.astral.sh/uv/))
- A Supabase project with the Phase 2 schema applied (run
  `local/supabase/setup.sql` in the dashboard SQL Editor)
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
```

Convenience from repo root: `pnpm worker:sync` (= `cd workers/yfinance && uv run python -m eyesinvest_worker all`).

## What it writes

| Command | Writes to | Notes |
|---|---|---|
| `sync-prices` | `ey_price_1d` | 2-year daily OHLC per active stock |
| `sync-quotes` | `ey_quote_snapshot` | Latest close + previous close + change % |
| `sync-fundamentals` | `ey_stocks` | `market_cap`, `pe_ratio`, `dividend_yield`, 52-wk range, etc. |
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
