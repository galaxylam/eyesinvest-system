# `sync-shorts` — HK (HKEX daily + SFC weekly) extension

`sync-shorts` now also writes short-selling data for HK-listed stocks.
The US FINRA path is untouched; HK arrives via two distinct free, no-auth
public sources.

## What it writes

| Dataset | HK source | HK cadence | Table written | Row shape |
|---|---|---|---|---|
| Daily aggregated short-sale turnover (full day) | HKEX public stats page | T+0 (post-16:00 HKT close) | `ey_short_sale_1d` (`market='HK'`) | `(stock_id, trade_date)` |
| Morning-session short-sale turnover (AM) | HKEX public stats page | T+0 (around 12:00–13:00 HKT lunch break) | `ey_short_sale_1d` (`market='HK'`) — same row, AM columns | `(stock_id, trade_date)` |
| Weekly aggregated reportable short positions | SFC weekly CSVs | Weekly (Friday) | `ey_short_interest` (`market='HK'`) | `(stock_id, settlement_date)` |

US rows are written as `(market='US', source='finra')`. HK daily rows
land as `(market='HK', source='hkex')` and HK weekly rows as
`(market='HK', source='sfc')`. The `ey_short_sale_1d.short_value_hkd`
column (reserved in migration 0005 for exactly this purpose) is
populated for HK rows with the published HKD turnover; `total_volume`
is `0` because the HKEX public page does not publish it. The AM fields
(`am_short_volume`, `am_short_value_hkd`, `am_published_at` —
migration 0012) are populated by `sync_hkex_short_sales_combined` when
the morning-session page is published; both AM and full-day data land
in the **same row** via a single upsert.

## Sources — endpoints and cadence

### 1. HKEX daily short-selling turnover (full day)

- **Main Board**:
  <https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTMAIN.HTM>
- **GEM**:
  <https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/ASHTGEM.HTM>
  (same `/ncms/` directory as Main Board — there is no separate `gcms/`
  subdirectory for short-selling turnover; GEM pages are named `ASHTGEM.HTM`,
  not `gcms/ASHTMAIN.HTM`)
- Pages are rendered as a `<pre><font size='1'>` plain-text block; each
  row is `code name shortSellShares shortSellTurnoverHKD pct%`.
- Populated on a schedule HKEX controls:
  - **Normal trading day** (Mon–Fri except eves): data appears at
    ~**16:00 HKT** (full-day close).
- **Outside** that window the page shows a
  `"…will be available after day close…"` placeholder. The provider
  detects that phrase and returns an empty list without raising — running
  `sync-shorts` outside trading hours is a no-op for HK full-day.

### 1b. HKEX morning-session short-selling turnover (AM)

- **Main Board**:
  <https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/MSHTMAIN.HTM>
- **GEM**:
  <https://www.hkex.com.hk/eng/stat/smstat/ssturnover/ncms/MSHTGEM.HTM>
- Same row layout as the full-day page; the parser and parser-side regex
  are shared with the full-day path.
- Populated around **12:00–13:00 HKT** (lunch break). Pre-lunch the page
  shows its own placeholder text ("will be available after …"); the
  provider matches the substring `will be available after` and returns
  no rows.
- Two additional HTTP requests per `sync-shorts` run; `MSHTGEM.HTM` is
  unverified — if it 404s, the AM Main Board page alone covers the bulk
  of HKEX-tracked stocks and the empty GEM result is benign.

The combined sync (`sync_hkex_short_sales_combined`) fetches all four
pages (full-day Main + GEM, AM Main + GEM), merges into one
`ShortSaleRow` per stock, and upserts to `ey_short_sale_1d`. Behavior
matrix:

| Full-day | AM | Row written |
|---|---|---|
| published | published | both `short_volume`/`short_value_hkd` + `am_*` populated |
| published | not yet | full-day only; `am_*` = NULL |
| not yet (mid-day) | published | `short_volume=0` (placeholder) + `am_*` populated |
| not yet | not yet | no row |

The chart uses `short_volume=0` as the "no full-day bar yet" sentinel so
only the AM bar renders between lunch and close.

> **Important:** the per-row column layout above is the documented
> expectation. **It has not been verified against a populated weekday
> file during this implementation** (the day this was first written, a
> Sunday, returned the placeholder). On the first weekday after ship,
> eyeball the parsed rows by running `sync-shorts` and grep'ing logs for
> `HKEX * ASHTMAIN: N rows parsed` — if the count is wildly off or the
> regex silently rejects every row, adjust the `_ROW_RE` in
> `providers/hkex_daily.py`.

### 2. SFC weekly aggregated reportable short positions

- **Index page** (lists every weekly CSV with issue date in the URL):
  <https://www.sfc.hk/en/Regulatory-functions/Market/Short-position-reporting/Aggregated-reportable-short-positions-of-specified-shares>
- **Individual weekly CSV**:
  `https://www.sfc.hk/-/media/EN/pdf/spr/YYYY/MM/DD/Short_Position_Reporting_Aggregated_Data_YYYYMMDD.csv`

CSV columns (5-field, plain):

```
Date, Stock Code, Stock Name, Aggregated Reportable Short Positions (Shares), Aggregated Reportable Short Positions (HK$)
14/08/2026, 1, CKH HOLDINGS, 44039315, 3084954016
14/08/2026, 700, TENCENT, …, …
```

- 729+ files since the first release on 2012-09-14.
- The provider pulls the index, fetches only CSVs newer than the
  highest `settlement_date` already stored in
  `ey_short_interest where market='HK'`, and upserts. On first-ever run
  with no HK rows it backfills the last `SFC_BACKFILL_DAYS` (180 by
  default) — to grab the full 2012 → present archive, set
  `SHORTS_FORCE_SFC_BACKFILL=1`.

## Symbol mapping

HK rows join on **numeric HK stock code**, not `ey_stocks.symbol`.

- `ey_stocks.symbol` for HK is the yfinance format (`0700.HK`,
  `0001.HK`, `12345.HK`).
- SFC's `Stock Code` column is a 1–5 digit integer with no leading
  zero (`700` for Tencent, `1` for CKH).
- `config.hk_stock_symbol_to_code("0700.HK") -> 700`.

GEM stocks not present in `ey_stocks` are silently dropped at the
`hk_code_to_id` lookup — same defensive shape as the FINRA
`symbol_map.get(...)`.

## CLI usage

```bash
# From workers/yfinance/ — HK is folded into the existing sync-shorts run.
uv run python -m eyesinvest_worker sync-shorts

# Run the broader worker (also picked up):
uv run python -m eyesinvest_worker all

# From repo root:
pnpm worker:sync      # existing alias; HK now included.
```

Expected log shape on success:

```
syncing short-selling for 20 US + 11 HK stocks (11 HK codes known)
US: using authenticated FINRA Developer API      # or CDN fallback
... (US path unchanged) ...
HKEX Main Board ASHTMAIN: 612 rows parsed
HKEX GEM ASHTGEM: 124 rows parsed
HK upserts: 17 daily → ey_short_sale_1d, N weekly → ey_short_interest
fetching SFC aggregated short-position index
SFC: syncing 1 weekly CSV file(s)
SFC 2026-08-14: 11 tracked / 1224 untracked rows
sync-shorts done — US 1260d / 70w, HK 17d / 11w
```

The "0 daily" line on a weekend is normal.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Service-role key (write access) |
| `SFC_BACKFILL_DAYS` | no | 180 | On first-ever SFC run with no rows, fetch weekly CSVs back this many calendar days. Raise to backfill further. |
| `SHORTS_FORCE_SFC_BACKFILL` | no | unset | `=1` ignores the last-stettlement cutoff and forces a fresh backfill (useful after wiping `ey_short_interest where market='HK'`). |
| `HK_SHORTS_HISTORY_DAYS` | no | 5 | Purely defensive — the HKEX public page only carries today's data, but the knob exists for symmetry with `SHORT_SALE_HISTORY_DAYS`. |

## Throttling & errors

- **SFC**: 0.3 s between file fetches. Each file is a flat CSV ≤ 60 KB.
- **HKEX**: two requests per run (Main Board + GEM), no inter-ticker
  loop. UA spoofed to look like a real browser.
- **Per-source failures are non-fatal.** `_http_get_text` returns
  `None` on any HTTP/timeout/OSError; the caller logs a warning and
  returns an empty list. The `sync-shorts` command always reaches its
  "done" log line.
- **Placeholder detection** on the HKEX pages: the substring
  `will be available after day close` (full-day) or
  `will be available after` (morning-session) signals an unpopulated
  page and is not an error.
- **GEM parse failures** would be visible via `HKEX GEM ASHTMAIN: 0
  rows parsed` (or a row count that doesn't match the rough expected
  ~100). Investigate the regex in `providers/hkex_daily.py::_ROW_RE`.

## Caveats

1. **HKEX daily page parser format is unverified** in code; see the
   callout above. If the column layout changed since this doc was
   written, only the regex needs adjusting — every other provider
   contract still holds.
2. **`total_volume` is `0` for HK daily rows.** The HKEX public page
   does not publish total daily volume, so the UI's derived
   `shortPctOfVolume` falls back to `null` (renders as `—`). The
   absolute `shortVolume` and `short_value_hkd` are still surfaced.
3. **`days_to_cover` is not stored for HK rows.** The SFC CSV only
   exposes current aggregated positions; `days_to_cover` /
   `change_pct` / `prior_short_interest` are `NULL` on the row. The UI
   computes a usable `daysToCover` locally from the last-30-day
   `ey_price_1d` volume — same derivation used for US. Change %
   therefore shows `—` for HK until the SFC format grows that column.
4. **HK daily is T+0 only.** No historical archive — HK daily bars
   extend only as far back as the first day the worker ran post-ship.
5. **SFC weekly is genuinely weekly** (every Friday close, published
   early the following week), not bi-weekly like FINRA's. The table
   column `settlement_date` and worker naming use "settlement"
   generically — fine.

## Verification

```bash
# 1. Apply migration 0007 to your local Supabase:
#    (via dashboard SQL editor or `supabase db reset`)

# 2. Smoke run:
cd workers/yfinance
uv run python -m eyesinvest_worker sync-shorts
# Look for the HK block in the log.

# 3. Verify rows landed (psql):
psql -d eyesinvest -c "
  select market, count(*) from ey_short_sale_1d group by market;
  select market, count(*) from ey_short_interest group by market;"

# 4. Spot-check Tencent (0700.HK) + a smaller HK name:
psql -d eyesinvest -c "
  select trade_date, short_volume, short_value_hkd, source
  from ey_short_sale_1d join ey_stocks s on s.id=stock_id
  where s.symbol='0700.HK' order by trade_date desc limit 5;
  select settlement_date, short_interest, source
  from ey_short_interest join ey_stocks s on s.id=stock_id
  where s.symbol='0700.HK' order by settlement_date desc limit 5;"

# 5. UI:
pnpm dev
#  /en/stocks/0700.HK → ShortSellingChart renders daily bars + interest line
#                       + header pills; no "empty" copy.
#  /en/stocks/AAPL    → unchanged from US path.
```

## Out of scope (still)

- Historical HK daily bars before the worker first ran.
- The HKEX Data Marketplace DSSD subscription feed (clean historical
  archive, paid).
- Real-time intraday HK short-sale data.

Short squeeze detector / squeeze scoring is now implemented as `sync-squeeze`
— it reads `ey_short_interest` + the most-recent `ey_short_sale_1d` row and
writes 6 nullable columns on `ey_stock_analytics` (`squeeze_score`, `_dtc`,
`_si_chg_1w`, `_drawdown_30d`, `_volume_spike`, `_am_ratio`). See
[`docs/SQUEEZE.md`](../../docs/SQUEEZE.md) for the formula + regime bands.
