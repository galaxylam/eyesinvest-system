# Screener filter combination backtest

Replays every combination of the `/screener` filters over the full price history in
Supabase and reports which ones produced a positive Sharpe ratio / return on the
**US** and **HK** universes.

```
scripts/backtest/
├── fetch_data.py   # pull ey_stocks / ey_price_1d / ey_short_interest / ey_short_sale_1d
├── pipeline.py     # point-in-time signal panel + filter masks + metrics
├── run_backtest.py # runs the 1–3 filter grid for both markets
├── report.py       # self-contained HTML report
├── summary_md.py   # markdown summary for docs/
├── verify.py       # independent re-computation of the indicators (sanity check)
└── out/            # results.csv · results.json · report.html
```

## Run it

```bash
# 1. refresh the cached raw data (skips tables already in data/)
workers/yfinance/.venv/bin/python scripts/backtest/fetch_data.py

# 2. run the grid + write the reports (~15 s)
workers/yfinance/.venv/bin/python scripts/backtest/run_backtest.py

# 3. optional: verify the indicator maths against a from-scratch implementation
workers/yfinance/.venv/bin/python scripts/backtest/verify.py
```

`fetch_data.py` reads the Supabase URL + service-role key from `apps/web/.env.local`
and caches gzip CSVs under `scripts/backtest/data/`. Everything downstream is offline.

## What is being measured

| Step | Definition |
|---|---|
| Signal | close of session **T**, using only data available on T |
| Entry | close of session **T+1** (no same-close lookahead) |
| Exit | close of session **T+22** (21-session hold) |
| Basket | every stock in the market that passes the filter combination, equal weight |
| Rebalance | every 21 sessions, non-overlapping periods |
| Benchmark | equal-weight universe, same rebalance dates |
| Sharpe | mean / stdev of the period returns × √12 (annualised) |
| Alpha/mo | average forward 21-session return of the picks − the same for the universe |

Indicator formulas are copied from
`workers/yfinance/src/eyesinvest_worker/providers/analytics.py`; filter comparisons mirror
`apps/web/src/lib/stocks/queries.ts :: applyScreenerFilters` (nulls never match a
filter, and the `>` / `<` boundaries follow the live dropdown values).

The one deliberate deviation: the squeeze score is recomputed **point-in-time** for every
date from the short-interest settlement known on that date. The production worker writes
today's score onto every historical row, which would leak future information into a
backtest. The HK morning-session component is dropped because AM short volume only
exists from 2026-08.

## Filters under test

| Filter | Values |
|---|---|
| 1M return | ≥ +10% · ≥ 0% · ≤ 0% |
| Crowded | ≥ 1.5× · ≥ 1.0× · < 0.8× |
| Squeeze | ≥ 30 · ≥ 40 · ≥ 50 |
| MA5 | rising · falling · flat (\|slope\| < 0.1% of price) |
| MA20 | rising · falling · flat (\|slope\| < 0.1% of price) |
| 1M Green Share | > +30% green · > +10% green · < −20% red |
| 1M Push/Pull Ease | ≥ +30% easy up · ≥ +10% easy up · ≤ −20% easy down |

`flat` is an extension of the screener's up/down MA filter — it has no dropdown
equivalent, everything else maps 1:1 onto a live dropdown value.

## Credibility gate

A combination only counts as a finding when it produced a tradable basket often
enough to measure: **≥5 names** per typical rebalance, **≥12 monthly periods**
with a position, and **≥500 stock-level observations** behind the t-stat.
Combinations that fail the gate still appear in the appendix, tagged `thin`.

## Caveats

- 2,310 combinations were scored → multiple testing. A positive Sharpe alone is not
  evidence of edge; read the out-of-sample and the three sub-period columns together.
- Survivorship bias: the universe is the *currently active* stock list.
- Sample window 2023-08 → 2026-10 (≈3 years, 35 monthly periods per market).
- Max drawdown is measured on monthly closes only.
- Gross results by default; the `Sharpe net` column charges a 25bp round trip once
  per monthly rebalance.
