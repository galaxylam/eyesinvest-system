# `sync-squeeze` — short-squeeze score (0..100 composite)

Phase 3+ analytical layer on top of the existing short-selling data.
Combines **days-to-cover**, **short-interest week-over-week change**,
**30-day drawdown**, **volume spike**, and the **HK-only morning-session
share** into a single 0..100 score, surfaced as `SqueezeCard` on the stock
detail page and as a screener column + filter. No new table — extends
`ey_stock_analytics` with six nullable columns (migration `0013_short_squeeze.sql`).

## Scoring formula

```
score = 100 × (
  0.30 × clip((dtc       −  0) / 10,   0, 1)   # DTC (0..10 trading days)
  0.25 × clip((si_chg_1w − -30)/ 60,   0, 1)   # SI Δ 1W (-30..+30 %)
  0.20 × clip((-drawdown −  0) / 0.30, 0, 1)   # |drawdown| (0..30 %; raw is already a fraction)
  0.15 × clip((vol_spike −  1) / 4,    0, 1)   # 1×..5× trailing
  0.10 × clip((am_ratio  − 40) / 40,   0, 1)   # 40..80 % (HK only — null otherwise)
)
```

`clip(x, lo, hi) = max(lo, min(hi, x))`. Each component is normalised to
`[0, 1]` and contributes `weight × normalised`. Weights sum to 1.0.

### Component inputs

| Component   | Computation                                                            | Null condition                         |
|-------------|------------------------------------------------------------------------|----------------------------------------|
| `dtc`       | `latest.short_interest ÷ 30d avg daily volume`                         | either input missing or `avg_vol ≤ 0`  |
| `si_chg_1w` | FINRA `change_pct`; fallback `(latest - prior) / prior × 100`          | no prior settlement                    |
| `drawdown`  | `max_drawdown_30d` snapshot (negative fraction, e.g. `-0.18` = -18 %)  | <30 trading days of history            |
| `vol_spike` | `mean(volume[-5:]) / mean(volume[-30:])`                               | <30 trading days                       |
| `am_ratio`  | HK-only. `am_short_volume / short_volume × 100` from the most-recent   | US row, or no full-day sale yet        |

When **every** input is null, the worker writes `NULL` for `squeeze_score`
and the breakdown columns — never a synthetic zero. The UI surfaces "Squeeze
score is not available" instead of a misleading number.

### Regime bands

Worker applies the following thresholds (deterministic) and the UI mirrors them:

| Regime    | Threshold    | Cell tone (UI)      |
|-----------|--------------|---------------------|
| High      | `score ≥ 70` | `rose-500`          |
| Elevated  | `score ≥ 50` | `amber-500`         |
| Normal    | `score ≥ 30` | `fg` (default)      |
| Low       | `< 30`       | `fg-muted`          |
| Unknown   | `null`       | panel renders empty |

US rows are capped at 0.90 × 100 = 90 because the `am_ratio` weight is
absorbed as zero. Acceptable trade-off — HK-only signal can't be replaced.

## What the worker writes

Migration `0013_short_squeeze.sql` adds these columns to `ey_stock_analytics`
(all nullable; pre-0013 rows stay valid):

| Column                  | Type           | Purpose                                                |
|-------------------------|----------------|--------------------------------------------------------|
| `squeeze_score`         | `numeric(5,2)` | 0..100 composite                                       |
| `squeeze_dtc`           | `numeric(6,2)` | days-to-cover                                          |
| `squeeze_si_chg_1w`     | `numeric(8,4)` | signed percent                                         |
| `squeeze_drawdown_30d`  | `numeric(8,6)` | snapshot of `max_drawdown_30d` at compute time         |
| `squeeze_volume_spike`  | `numeric(6,2)` | mean(vol[-5:]) / mean(vol[-30:])                       |
| `squeeze_am_ratio`      | `numeric(5,2)` | HK-only AM share of full-day (%)                       |

A partial index `(as_of_date desc, squeeze_score desc) where squeeze_score is not null`
speeds up the screener's "top squeeze candidates" query against the latest
as_of_date.

## How the worker computes it

1. Reads `ey_price_1d` for the stock (full history — used by `compute_analytics`
   to derive MA / RSI / MACD / drawdown / volume-spike).
2. Reads `ey_short_interest` desc-sorted, limit 2 → DTC + SI Δ 1W inputs.
3. Reads the most-recent `ey_short_sale_1d` row → HK AM-ratio input.
4. Calls `compute_analytics(..., short_interest_rows=[...], latest_short_sale=(am_vol, vol))`
   which computes the 6 squeeze columns + the composite score and packs them
   into each `StockAnalyticsRow`.
5. `upsert_analytics_rows` writes via PostgREST `.upsert()` — partial-row upsert
   preserves other columns on the same `(stock_id, as_of_date)` PK.

`sync-squeeze` is added to the `sync_all` aggregator between `sync-shorts`
and `sync-sector-strength`. Run order matters: prices + shorts must be
fresh so the inputs are valid.

## How the UI surfaces it

- **Stock detail page** — `<SqueezeCard>` mounts above `<AnalyticsPanel>` on
  every stock. Server component, mirrors `AnalyticsPanel`'s `<section>` +
  `<dl>` grid pattern. Renders the composite score, regime pill, 20-cell
  inline progress bar, and 4-column breakdown (DTC / SI Δ / drawdown /
  volume spike), with an HK-only AM-share row when present. Null score →
  "Squeeze score is not available" panel.
- **Screener** — `col.squeeze` column (right-aligned, color-toned by regime:
  `≥70 rose-500`, `≥50 amber-500`, else `fg`). `ScreenerFilters` adds a
  dropdown bound to `?sq=` for `squeezeMin ∈ {40, 60, 80}` (matching the
  regime bands). Sortable via `?sort=squeezeScore&dir=desc`.

## CLI usage

```bash
# Standalone (after sync-analytics + sync-shorts):
uv run python -m eyesinvest_worker sync-squeeze

# From repo root (full chain — now 8 steps including squeeze):
pnpm worker:sync

# Quick smoke check (per-stock log line shows score):
#   [12/30] AAPL: score=42.50
#   [13/30] TSLA: score=n/a
```

Expected log shape on success:

```
=== sync-squeeze ===
computing squeeze scores for 30 stocks
squeeze [1/30] AAPL: score=42.50
squeeze [2/30] MSFT: score=28.10
...
squeeze [30/30] 0700.HK: score=78.30
sync-squeeze done — 7560 indicator rows written, 28 stocks with a numeric score
```

The "N stocks with a numeric score" count is `< 30` on a fresh database (no
prior `ey_short_interest` row to derive SI Δ 1W from) and converges to `30`
within 1–2 weeks of regular `sync-shorts` runs.

## Caveats

1. **No fresh data on `sync-analytics` runs** — only `sync-squeeze` populates
   the squeeze columns. `sync-analytics` alone (without `sync-squeeze`)
   leaves the 6 columns NULL on every row. The `sync_all` aggregator runs
   both in sequence, so the final state of `ey_stock_analytics` is complete.
2. **CDN-only FINRA** leaves `change_pct` NULL on `ey_short_interest` rows.
   The worker's fallback `(latest - prior) / prior × 100` derives an
   equivalent value from `prior_short_interest`. No degradation.
3. **HK AM ratio** only populates after ~12:30 HKT on the latest
   `ey_short_sale_1d` row. Before that, the AM slot contributes 0 to the
   score — same as the existing AM overlap bar behaviour.
4. **First-ever `sync-squeeze`** on a fresh database has no prior
   `ey_short_interest` row → `si_chg_1w = null` → that component drops to
   0. Within 1–2 weeks of regular `sync-shorts` runs the value becomes
   meaningful.
5. **Regime bands are heuristic** — backtesting against real squeeze
   candidates (e.g. GME 2021-01, AMC 2021-06, VW 2008-10) is out of scope.
   The bands are intuitive defaults and tunable via the worker constants
   in `_squeeze_score`.
6. **No real-time push** — score updates on the next page load after a
   `sync-squeeze` run. Same refresh model as the rest of the system.
7. **Screener LIMIT (200)** means sorting by `squeezeScore desc` shows the
   200 highest-scoring stocks the user has access to — sufficient for the
   current ~30-stock universe.
8. **Mock data behaviour** — `apps/web/src/lib/stocks/mock-data.ts::getMockSqueeze`
   uses the same formula + weights as the worker (kept in lockstep via
   shared component comments). Mock scores are deterministic across re-renders
   via the existing `makeRng(symbolSeed(\`${symbol}-squeeze\`))` pattern.

## Verification

```bash
# 1. Apply migration 0013:
psql -d eyesinvest -f local/supabase/migrations/0013_short_squeeze.sql

# 2. Pure-Python helper smoke (no HTTP / Supabase):
cd workers/yfinance && uv run python -c "
from eyesinvest_worker.providers.analytics import _squeeze_score
print(_squeeze_score(8.5, 12.0, -0.15, 2.4, 71.0))   # expect ~64
print(_squeeze_score(0, 0, 0, 1.0, None))             # expect ~3.75 (US baseline)
print(_squeeze_score(None, None, None, None, None))  # expect None
"

# 3. Run the tests:
uv run pytest tests/test_squeeze.py -v

# 4. End-to-end after sync-shorts:
uv run python -m eyesinvest_worker sync-squeeze
# Look for "sync-squeeze done" + per-stock score log lines.

# 5. Spot-check Supabase:
psql -d eyesinvest -c "
  select s.symbol, sa.squeeze_score, sa.squeeze_dtc,
         sa.squeeze_si_chg_1w, sa.squeeze_am_ratio
  from ey_stock_analytics sa
  join ey_stocks s on s.id = sa.stock_id
  where sa.as_of_date = (select max(as_of_date) from ey_stock_analytics)
    and sa.squeeze_score is not null
  order by sa.squeeze_score desc limit 10;
"

# 6. UI:
pnpm dev
# /en/stocks/0700.HK → SqueezeCard appears above AnalyticsPanel, AM-share row present.
# /en/stocks/AAPL    → SqueezeCard visible, no AM row, score in 0..90 range.
# /en/screener?sq=60 → Table filtered to ≥60, "Squeeze" column colour-toned.
# /en/screener?sort=squeezeScore&dir=desc → Highest-scoring stocks first.

# 7. Mock fallback (no Supabase):
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= pnpm dev
# /en/stocks/0700.HK → Mock squeeze score derived deterministically.
```