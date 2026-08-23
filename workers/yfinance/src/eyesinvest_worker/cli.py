"""Click CLI entry point — `python -m eyesinvest_worker <subcommand>`."""

from __future__ import annotations

import sys
import time

import click

from eyesinvest_worker import __version__
from eyesinvest_worker.config import WorkerConfig
from eyesinvest_worker.db import (
    fetch_active_stocks,
    fetch_price_history,
    make_client,
    upsert_analytics_rows,
    upsert_fundamentals,
    upsert_index_quotes,
    upsert_price_bars,
    upsert_quote_snapshot,
)
from eyesinvest_worker.log import configure_logging, logger
from eyesinvest_worker.models import Fundamentals, IndexQuote
from eyesinvest_worker.providers import (
    compute_analytics,
    fetch_daily_history,
    fetch_fundamentals,
    fetch_index_quote,
    fetch_quote_snapshot,
)

# Stable iteration order so the `all` command is reproducible.
_INDEX_CODES = ("SPX", "HSI")


def _load_config() -> WorkerConfig:
    # Trigger .env load explicitly so the same code path works whether the
    # user runs `python -m` or `eyesinvest-worker` (installed script).
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:  # pragma: no cover — dotenv is in deps
        pass
    return WorkerConfig()  # type: ignore[call-arg]


@click.group()
@click.version_option(__version__, prog_name="eyesinvest-worker")
def main() -> None:
    """EyesInvest yfinance sync worker."""


@main.command("sync-prices")
def sync_prices() -> None:
    """Pull 2-year daily OHLC for every active stock."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = fetch_active_stocks(client)
    logger.info(f"syncing daily OHLC for {len(stocks)} stocks")

    total = 0
    for i, s in enumerate(stocks, start=1):
        bars = fetch_daily_history(
            stock_id=s.id,
            symbol=s.symbol,
            currency=s.currency,
            years=cfg.history_period_years,
        )
        if bars:
            total += upsert_price_bars(client, bars)
            logger.info(f"[{i}/{len(stocks)}] {s.symbol}: {len(bars)} bars")
        else:
            logger.warning(f"[{i}/{len(stocks)}] {s.symbol}: no bars")
        time.sleep(cfg.price_throttle_seconds)

    logger.info(f"sync-prices done — {total} rows written")


@main.command("sync-quotes")
def sync_quotes() -> None:
    """Compute the latest per-stock quote snapshot."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = fetch_active_stocks(client)
    logger.info(f"computing quote snapshots for {len(stocks)} stocks")

    quotes = []
    for i, s in enumerate(stocks, start=1):
        q = fetch_quote_snapshot(stock_id=s.id, symbol=s.symbol)
        if q is not None:
            quotes.append(q)
            logger.info(f"[{i}/{len(stocks)}] {s.symbol}: {q.last_price:.2f} {s.currency}")
        else:
            logger.warning(f"[{i}/{len(stocks)}] {s.symbol}: no quote")
        time.sleep(cfg.price_throttle_seconds)

    upsert_quote_snapshot(client, quotes)
    logger.info(f"sync-quotes done — {len(quotes)} snapshots written")


@main.command("sync-fundamentals")
def sync_fundamentals() -> None:
    """Pull .info metrics for every active stock."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = fetch_active_stocks(client)
    logger.info(f"syncing fundamentals for {len(stocks)} stocks")

    fundamentals_by_symbol: dict[str, Fundamentals] = {}
    for i, s in enumerate(stocks, start=1):
        f = fetch_fundamentals(symbol=s.symbol)
        if f is not None:
            fundamentals_by_symbol[s.symbol] = f
            logger.info(f"[{i}/{len(stocks)}] {s.symbol}: ok")
        else:
            logger.warning(f"[{i}/{len(stocks)}] {s.symbol}: no info")
        time.sleep(cfg.info_throttle_seconds)

    upsert_fundamentals(client, fundamentals_by_symbol, stocks)
    logger.info(f"sync-fundamentals done — {len(fundamentals_by_symbol)} stocks updated")


@main.command("sync-analytics")
def sync_analytics() -> None:
    """Compute MA / RSI / MACD / volatility / drawdown / returns for every stock."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = fetch_active_stocks(client)
    logger.info(f"computing analytics for {len(stocks)} stocks")

    total = 0
    for i, s in enumerate(stocks, start=1):
        rows = fetch_price_history(client, s.id)
        if not rows:
            logger.warning(f"[{i}/{len(stocks)}] {s.symbol}: no price history")
            continue
        result = compute_analytics(stock_id=s.id, bars=rows)
        if result.rows:
            total += upsert_analytics_rows(client, result.rows)
            logger.info(
                f"[{i}/{len(stocks)}] {s.symbol}: {len(result.rows)} indicator rows"
            )
        else:
            logger.warning(f"[{i}/{len(stocks)}] {s.symbol}: no analytics rows")
        time.sleep(cfg.price_throttle_seconds)

    logger.info(f"sync-analytics done — {total} indicator rows written")


@main.command("sync-indexes")
def sync_indexes() -> None:
    """Refresh SPX + HSI latest daily quotes."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    logger.info(f"fetching index quotes for {list(_INDEX_CODES)}")

    quotes: list[IndexQuote] = []
    for i, code in enumerate(_INDEX_CODES, start=1):
        q = fetch_index_quote(code)
        if q is not None:
            quotes.append(q)
            logger.info(f"[{i}/{len(_INDEX_CODES)}] {code}: {q.last:.2f}")
        else:
            logger.warning(f"[{i}/{len(_INDEX_CODES)}] {code}: no data")
        time.sleep(cfg.price_throttle_seconds)

    upsert_index_quotes(client, quotes)
    logger.info(f"sync-indexes done — {len(quotes)} index rows written")


@main.command("all")
def sync_all() -> None:
    """Run every sync command in sequence: prices → quotes → fundamentals → analytics → indexes."""
    for cmd in (
        "sync-prices",
        "sync-quotes",
        "sync-fundamentals",
        "sync-analytics",
        "sync-indexes",
    ):
        logger.info(f"=== {cmd} ===")
        # Re-invoke this CLI as a subprocess so config + logging re-init cleanly.
        rc = sys.exit(cli_main([cmd]))
        if rc != 0:
            raise click.ClickException(f"{cmd} failed (exit {rc})")


def cli_main(args: list[str]) -> int:
    """Helper for `sync_all` — return exit code instead of calling sys.exit."""
    try:
        main.main(args=args, standalone_mode=False)
    except click.exceptions.Abort:
        return 1
    except click.exceptions.ClickException as e:
        e.show()
        return e.exit_code
    except SystemExit as e:
        return int(e.code or 0)
    return 0


if __name__ == "__main__":
    main()