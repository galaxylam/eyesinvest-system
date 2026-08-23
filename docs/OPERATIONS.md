# EyesInvest — Operations runbook

Routine procedure for keeping the platform's data fresh, plus troubleshooting
and a forward-looking map of what each phase will add.

---

## Phase 3 — what's wired today

| Data | Source | Where it's stored | Worker command |
|---|---|---|---|
| Daily OHLC (2-year history) | Yahoo Finance | `ey_price_1d` | `sync-prices` |
| Latest quote + change % | Yahoo Finance | `ey_quote_snapshot` | `sync-quotes` |
| Market cap, P/E, dividend yield, 52-wk range | Yahoo Finance | `ey_stocks.*` columns | `sync-fundamentals` |
| Top movers (derived) | Postgres view | `ey_v_top_movers` | (auto from quote snapshots) |
| Technical indicators (MA / RSI / MACD / vol / drawdown / returns) | derived from `ey_price_1d` | `ey_stock_analytics` | `sync-analytics` |
| Reference indices (SPX, HSI) | Yahoo Finance | `ey_index_quote` | `sync-indexes` |

**Stock prices, sector strengths, news, and AI analysis are different
categories** — the table above only covers the first. Sector strength,
news ingestion, and AI mapping are not built yet. See the "Forward phases"
section at the end for the planned cadence.

---

## One-time setup

```bash
# Install uv (one-time per machine)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install worker deps (one-time per worker checkout)
cd workers/yfinance
uv sync

# Create .env from template (one-time, then fill in real values)
cp .env.example .env
# Edit .env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
#   Supabase Dashboard → Project Settings → API

cd ../..
```

After editing `.env`, run a single full sync to confirm everything connects:

```bash
pnpm worker:sync
```

Expected tail:

```
[INFO] sync-prices done — XXXX rows written
[INFO] sync-quotes done — 30 snapshots written
[INFO] sync-fundamentals done — 30 stocks updated
[INFO] sync-analytics done — XXXX indicator rows written
[INFO] sync-indexes done — 2 index rows written
```

---

## Routine updates

### Recommended cadences

| Sync | Cadence | Why | Command |
|---|---|---|---|
| `sync-quotes` | every 5–15 min during market hours | Top Movers + stock header show real-time-ish change % | `pnpm worker:sync` or just `uv run python -m eyesinvest_worker sync-quotes` |
| `sync-prices` | once per trading day, ~30 min after US close (~17:00 ET) | Daily OHLC bars; intraday bars aren't tracked yet | `uv run python -m eyesinvest_worker sync-prices` |
| `sync-fundamentals` | weekly (e.g. Sunday night) | Market cap / P/E / dividend yield / 52-wk range change slowly | `uv run python -m eyesinvest_worker sync-fundamentals` |
| `sync-analytics` | daily, right after `sync-prices` | Drives the AnalyticsPanel on every stock detail page | `uv run python -m eyesinvest_worker sync-analytics` |
| `sync-indexes` | daily, after US close + at 09:00 HKT | Powers the Market Summary tiles (SPX, HSI) | `uv run python -m eyesinvest_worker sync-indexes` |
| **All five** | once per day (manual) | Convenience — runs the five above in sequence | `pnpm worker:sync` |

### Market-hours notes

- US market: 09:30–16:00 ET (Mon–Fri)
- HK market: 09:30–16:00 HKT (Mon–Fri)
- yfinance throttles aggressively — the worker already sleeps 0.5s between
  stocks and 1.0s between `.info` calls. If you bump the throttle, expect
  rate-limit errors.

### Manual / on-demand

`pnpm worker:sync` is idempotent — safe to run as often as you want. Each
step upserts (not appends), so re-running just refreshes the same rows.

### Automating with cron / launchd / GitHub Actions

Not built into Phase 2. Three recommended patterns:

**1. Local cron (Linux/macOS)** — schedule `pnpm worker:sync` in your user crontab:

```cron
# Weekday 17:30 ET — daily price + quote + fundamentals after US close
30 17 * * 1-5 cd /Users/galaxylam/Dropbox/VibeCoding/eyesinvest-system && pnpm worker:sync
```

**2. launchd (macOS native)** — create `~/Library/LaunchAgents/com.eyesinvest.worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.eyesinvest.worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>cd /Users/galaxylam/Dropbox/VibeCoding/eyesinvest-system && pnpm worker:sync</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>30</integer></dict>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.eyesinvest.worker.plist`.

**3. GitHub Actions** — schedule a workflow on a cron trigger. Store
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in repo secrets.

Trigger.dev orchestration is deferred to a later phase.

---

## Verifying a sync

After running, confirm data landed:

```bash
cd workers/yfinance
uv run python -c "
from dotenv import load_dotenv; load_dotenv()
from supabase import create_client
from eyesinvest_worker.config import WorkerConfig
cfg = WorkerConfig()
c = create_client(cfg.supabase_url, cfg.supabase_service_role_key)
print('ey_price_1d       :', c.table('ey_price_1d').select('*', count='exact', head=True).execute().count)
print('ey_quote_snapshot :', c.table('ey_quote_snapshot').select('*', count='exact', head=True).execute().count)
print('ey_stocks         :', c.table('ey_stocks').select('*', count='exact', head=True).execute().count)
"
```

Expected:
- `ey_price_1d` ≈ 21,000–22,000 rows (varies as days pass; ~730 bars × 30 stocks for 3y history)
- `ey_quote_snapshot` = 30
- `ey_stocks` = 30 (with fundamentals populated for stocks whose providers exposed them)
- `ey_stock_analytics` ≈ 21,000–22,000 rows (one per stock per trading day, after warm-up)
- `ey_index_quote` = 2 (SPX, HSI)

Then in the browser:

- `http://localhost:3000/en/dashboard` — Top Movers shows real rows with colored change %; Market Summary tiles show live SPX + HSI
- `http://localhost:3000/en/stocks/AAPL` — last price, candlestick chart, volume bars, key stats, technical indicators panel (MA / RSI / MACD / volatility / returns)
- Switch to `/zh-HK` — labels and number formatting localize

---

## Troubleshooting

### "relation does not exist"

Phase 3 schema not applied. Run `local/supabase/migrations/0004_analytics_and_indices.sql`
in the Supabase SQL Editor. The whole `setup.sql` is also re-runnable (idempotent).

### Worker runs but `ey_quote_snapshot` stays at 0

You ran `sync-prices` but the connection dropped before `sync-quotes` /
`sync-fundamentals`. Run them explicitly:

```bash
uv run python -m eyesinvest_worker sync-quotes
uv run python -m eyesinvest_worker sync-fundamentals
uv run python -m eyesinvest_worker sync-analytics
uv run python -m eyesinvest_worker sync-indexes
```

### Worker exits with `Invalid API key` / 401

Your `SUPABASE_SERVICE_ROLE_KEY` in `workers/yfinance/.env` is wrong or
missing. Service-role is **not** the anon key — copy it from
`Supabase Dashboard → Settings → API → service_role`.

### Worker logs `history() failed: ...` for one stock

yfinance rate-limit or a transient HTTP error. The worker logs and skips
per-ticker — one bad ticker doesn't abort the run. Re-run later if needed.

### Top Movers shows "Source: Supabase" but is empty

No rows in `ey_quote_snapshot`. Run `sync-quotes` (see above).

### App shows "—" everywhere despite data being in Supabase

`ey_quote_snapshot` or `ey_price_1d` was populated but the app still uses
mock. Confirm `apps/web/.env.local` has the matching `NEXT_PUBLIC_SUPABASE_URL`
+ `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the same project. Restart `pnpm dev`.

### macOS: `uv: command not found` after install

`~/.local/bin` isn't on PATH yet. Either restart your terminal or run
`source ~/.zshrc` (the install script adds it to your shell rc). You can
also call it directly: `~/.local/bin/uv`.

---

## Forward phases (not built yet)

The categories you mentioned beyond stock prices:

### Sector strength — Phase 3+

Today the `ey_stocks` table has `sector` and `industry` columns from the
seed data. Phase 3 ships `ey_stock_analytics` (per-stock technicals) and
`ey_index_quote` (reference indices). Still to come:

- `ey_sector_daily` — sector-level aggregated OHLC / relative strength
- Additional metrics on `ey_stock_analytics`: relative strength,
  volume efficiency, crowded ratio

### News — Phase 7

No tables yet. Phase 7 will add:

- `ey_news_article` — source / title / url / published_at / related stocks
- Worker command: `uv run python -m eyesinvest_worker sync-news`
- Cadence: every 30 min during market hours; off-hours every 2h

### AI analysis — Phase 8

No tables yet. Phase 8 will add:

- `ey_ai_event` — events the LLM extracts (earnings / guidance / M&A / …)
- `ey_ai_mapping` — relationship graph between entities (company → supplier,
  → competitor, → customer)
- OpenRouter integration; env var `OPENROUTER_API_KEY` already reserved in
  `.env.example`
- Cadence: nightly batch; on-demand for breaking news

### Real-time streaming — Phase 4+

Polling (5–15 min) is sufficient for Phase 2. Phase 4+ may add WebSocket
streaming for tick-level data.

---

## Quick command reference

```bash
# Full sync (prices + quotes + fundamentals + analytics + indexes)
pnpm worker:sync

# Just refresh the Top Movers / stock header
cd workers/yfinance && uv run python -m eyesinvest_worker sync-quotes

# Just refresh fundamentals (weekly)
cd workers/yfinance && uv run python -m eyesinvest_worker sync-fundamentals

# Just refresh price history
cd workers/yfinance && uv run python -m eyesinvest_worker sync-prices

# Just refresh the per-stock technical indicators
cd workers/yfinance && uv run python -m eyesinvest_worker sync-analytics

# Just refresh the reference index quotes (SPX, HSI)
cd workers/yfinance && uv run python -m eyesinvest_worker sync-indexes

# Verify row counts
cd workers/yfinance && uv run python -c "
from dotenv import load_dotenv; load_dotenv()
from supabase import create_client
from eyesinvest_worker.config import WorkerConfig
c = create_client(WorkerConfig().supabase_url, WorkerConfig().supabase_service_role_key)
for t in ('ey_price_1d','ey_quote_snapshot','ey_stocks','ey_stock_analytics','ey_index_quote'):
    n = c.table(t).select('*', count='exact', head=True).execute().count
    print(f'{t:22s} {n}')
"
```
