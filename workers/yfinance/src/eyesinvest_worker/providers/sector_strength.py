"""Sector strength aggregation — per-stock metrics + sector-level rollup.

Two passes inside one worker command (`sync-sector-strength`):

  Pass A (per-stock):
    For every active stock with a sector, fetch the trailing price history
    from `ey_price_1d`, plus shares_outstanding from `ey_stocks`, plus the
    stock's own market trailing returns from `fetch_index_trailing_returns`,
    and run `compute_analytics` with the 3 new columns populated. Upsert
    into `ey_stock_analytics` — same PK `(stock_id, as_of_date)` as the
    existing `sync-analytics`, so reruns are idempotent.

  Pass B (sector aggregation):
    From the just-written `ey_stock_analytics` rows for today's date, group
    by sector and compute member_count / breadth_pct / sector_return_N /
    RS vs global market / mean efficiency / mean crowded ratio. One row per
    sector per as_of_date — upserted into `ey_sector_daily`.

Failures are per-stock or per-sector, not run-level — matches `sync-analytics`.
yfinance failures on SPX/HSI are tolerated (RS columns fall back to null).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import mean
from typing import Iterable

from eyesinvest_worker.config import WorkerConfig
from eyesinvest_worker.db.supabase import (
    fetch_active_stocks_with_sector,
    fetch_price_history,
)
from eyesinvest_worker.log import logger
from eyesinvest_worker.models import (
    SectorDailyRow,
    StockAnalyticsRow,
    StockRecordWithSector,
)
from eyesinvest_worker.providers.analytics import compute_analytics
from eyesinvest_worker.providers.index_history import fetch_index_trailing_returns


@dataclass
class ComputeSectorResult:
    analytics_rows: list[StockAnalyticsRow] = field(default_factory=list)
    sector_rows: list[SectorDailyRow] = field(default_factory=list)
    as_of_date: date | None = None


def compute_sector_strength(client, cfg: WorkerConfig) -> ComputeSectorResult:
    """Run Pass A (per-stock) + Pass B (sector aggregation).

    Returns a `ComputeSectorResult` with both row lists ready for upsert.
    Caller (cli.py) handles the chunked writes.
    """
    lookback = cfg.sector_strength_lookback_days
    stocks = fetch_active_stocks_with_sector(client)
    if not stocks:
        logger.warning("sector-strength: no active stocks — skipping")
        return ComputeSectorResult(as_of_date=date.today())

    # Two yfinance calls — refetch SPX + HSI trailing bars for market-relative RS.
    market_returns = fetch_index_trailing_returns(cfg)
    spx_ok = bool(market_returns.get("SPX"))
    hsi_ok = bool(market_returns.get("HSI"))
    logger.info(
        f"sector-strength: {len(stocks)} stocks, lookback={lookback}, "
        f"benchmark ok: SPX={spx_ok} HSI={hsi_ok}"
    )

    # --- Pass A: per-stock ---
    analytics_rows: list[StockAnalyticsRow] = []
    today = date.today()
    cutoff = today - timedelta(days=lookback)
    for i, s in enumerate(stocks, start=1):
        if not s.sector:
            logger.debug(f"sector-strength: {s.symbol} has no sector — skipping")
            continue
        bars = fetch_price_history(client, s.id)
        if not bars:
            logger.warning(f"sector-strength [{i}/{len(stocks)}] {s.symbol}: no bars")
            continue
        # Trim history to the lookback window — older bars don't affect
        # the trailing-return / efficiency / crowded metrics.
        bars = [b for b in bars if date.fromisoformat(b["trade_date"]) >= cutoff]
        market_for_stock = market_returns.get("SPX" if s.market == "US" else "HSI", {})
        result = compute_analytics(
            stock_id=s.id,
            bars=bars,
            shares_outstanding=s.shares_outstanding,
            market_returns=market_for_stock,
        )
        if result and result.rows:
            analytics_rows.extend(result.rows)
            logger.info(
                f"sector-strength [{i}/{len(stocks)}] {s.symbol}: "
                f"{len(result.rows)} rows (sector={s.sector})"
            )
        else:
            logger.warning(f"sector-strength [{i}/{len(stocks)}] {s.symbol}: no analytics rows")
        time.sleep(cfg.price_throttle_seconds)

    if not analytics_rows:
        logger.warning("sector-strength: no analytics rows produced — skipping aggregation")
        return ComputeSectorResult(as_of_date=today)

    # --- Pass B: sector aggregation by latest as_of_date present ---
    # `analytics_rows` carries the actual trade_date from each stock's latest
    # bar — this can lag `date.today()` by a day or more on weekends, holidays,
    # or after a stale `sync-prices` run. We aggregate against the max
    # as_of_date so the sector row reflects "latest trading day we have data
    # for", not wall clock. Upsert PK is `(sector, as_of_date)`, so multiple
    # run days create distinct rows.
    latest_as_of = max(r.as_of_date for r in analytics_rows)
    sector_rows = _aggregate_sector_rows(
        analytics_rows=analytics_rows,
        stocks=stocks,
        market_returns=market_returns,
        as_of=latest_as_of,
    )
    logger.info(
        f"sector-strength: {len(sector_rows)} sector rows aggregated for as_of_date={latest_as_of}"
    )
    return ComputeSectorResult(
        analytics_rows=analytics_rows,
        sector_rows=sector_rows,
        as_of_date=latest_as_of,
    )


def _aggregate_sector_rows(
    analytics_rows: list[StockAnalyticsRow],
    stocks: list[StockRecordWithSector],
    market_returns: dict[str, dict[str, float]],
    as_of: date,
) -> list[SectorDailyRow]:
    """Group today's analytics rows by sector and produce one SectorDailyRow per sector.

    `analytics_rows` may include historical dates; we filter to rows with
    `as_of_date == as_of` so the sector aggregates represent the latest
    snapshot only. (The screener-style deep history isn't needed for the
    dashboard leaderboard tile.)
    """
    stock_to_sector: dict[str, str] = {
        s.id: s.sector for s in stocks if s.sector is not None
    }
    today_rows = [r for r in analytics_rows if r.as_of_date == as_of]

    # Group by sector.
    by_sector: dict[str, list[StockAnalyticsRow]] = {}
    for r in today_rows:
        sector = stock_to_sector.get(r.stock_id)
        if sector is None:
            continue
        by_sector.setdefault(sector, []).append(r)

    # Global market benchmark — equal-weight mean of (SPX, HSI) trailing
    # returns. Used for `rs_vs_market_N`. Sectors collapse US+HK under one
    # key, so a per-market split would explode the table.
    spx = market_returns.get("SPX", {})
    hsi = market_returns.get("HSI", {})
    global_market: dict[str, float | None] = {}
    for window in ("1w", "1m", "3m", "6m", "1y"):
        spx_v = spx.get(window)
        hsi_v = hsi.get(window)
        if spx_v is not None and hsi_v is not None:
            global_market[window] = round((spx_v + hsi_v) / 2.0, 6)
        elif spx_v is not None:
            global_market[window] = spx_v
        elif hsi_v is not None:
            global_market[window] = hsi_v
        else:
            global_market[window] = None

    out: list[SectorDailyRow] = []
    for sector, rows in by_sector.items():
        member_count = len(rows)
        breadth_pct = _breadth_pct(rows)
        sector_return = {
            w: _safe_mean(_col(rows, f"return_{w}")) for w in ("1w", "1m", "3m", "6m", "1y")
        }
        rs_vs_market = {
            w: _sub_or_none(sector_return[w], global_market[w])
            for w in ("1w", "1m", "3m", "6m", "1y")
        }
        out.append(
            SectorDailyRow(
                sector=sector,
                as_of_date=as_of,
                member_count=member_count,
                sector_return_1w=sector_return["1w"],
                sector_return_1m=sector_return["1m"],
                sector_return_3m=sector_return["3m"],
                sector_return_6m=sector_return["6m"],
                sector_return_1y=sector_return["1y"],
                rs_vs_market_1w=rs_vs_market["1w"],
                rs_vs_market_1m=rs_vs_market["1m"],
                rs_vs_market_3m=rs_vs_market["3m"],
                rs_vs_market_6m=rs_vs_market["6m"],
                rs_vs_market_1y=rs_vs_market["1y"],
                breadth_pct=breadth_pct,
                volume_efficiency_mean=_safe_mean(_col(rows, "volume_efficiency")),
                crowded_ratio_mean=_safe_mean(_col(rows, "crowded_ratio")),
                source="worker",
            )
        )
    return out


def _col(rows: Iterable[StockAnalyticsRow], name: str) -> list[float]:
    """Return the named attribute from each row, dropping None values."""
    out: list[float] = []
    for r in rows:
        v = getattr(r, name, None)
        if v is not None:
            out.append(float(v))
    return out


def _safe_mean(xs: list[float]) -> float | None:
    return round(mean(xs), 6) if xs else None


def _breadth_pct(rows: Iterable[StockAnalyticsRow]) -> float | None:
    """% of constituents with positive `return_1m`. Stored as 0..100 percent."""
    rets = _col(rows, "return_1m")
    if not rets:
        return None
    positive = sum(1 for r in rets if r > 0)
    return round(positive / len(rets) * 100.0, 2)


def _sub_or_none(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return round(a - b, 6)
