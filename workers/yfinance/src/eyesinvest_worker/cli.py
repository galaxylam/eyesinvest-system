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
    upsert_short_interest,
    upsert_short_sales,
)
from eyesinvest_worker.log import configure_logging, logger
from eyesinvest_worker.models import Fundamentals, IndexQuote
from eyesinvest_worker.providers import (
    compute_analytics,
    fetch_daily_history,
    fetch_fundamentals,
    fetch_index_quote,
    fetch_quote_snapshot,
    sync_short_interest,
    sync_short_sales,
)
from eyesinvest_worker.providers.finra_api import (
    FinraApiError,
    FinraClient,
    sync_short_interest_via_api,
    sync_short_sales_via_api,
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


@main.command("sync-shorts")
def sync_shorts() -> None:
    """Pull FINRA daily Reg-SHO + bi-weekly short-interest for US stocks.

    Prefers the authenticated Developer API (`regShoDaily` +
    `consolidatedShortInterest`) when FINRA_API_CLIENT_ID + SECRET are set;
    otherwise falls back to the public CDN TXT files. HK stocks are skipped
    (FINRA is US-only). Failures are logged + skipped rather than aborting
    the run.
    """
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = fetch_active_stocks(client)
    us_stocks = [s for s in stocks if s.market == "US"]
    symbol_map = {s.symbol: s.id for s in us_stocks}
    logger.info(f"syncing FINRA short-selling for {len(us_stocks)} US stocks")

    use_api = bool(cfg.finra_api_client_id and cfg.finra_api_secret)
    sales: list = []
    interest: list = []
    days = cfg.short_sale_history_days

    if use_api:
        logger.info("using authenticated FINRA Developer API")
        api = FinraClient(cfg.finra_api_client_id or "", cfg.finra_api_secret or "")
        try:
            sales = sync_short_sales_via_api(api, symbol_map, days=days)
            interest = sync_short_interest_via_api(api, symbol_map)
        except FinraApiError as exc:
            logger.warning(
                f"FINRA API path failed ({exc}); falling back to public CDN"
            )
            sales = sync_short_sales(client, symbol_map, days=days)
            time.sleep(cfg.price_throttle_seconds)
            interest = sync_short_interest(client, symbol_map, lookback_days=60)
    else:
        logger.info("FINRA_API_CLIENT_ID/SECRET not set; using public CDN")
        sales = sync_short_sales(client, symbol_map, days=days)
        time.sleep(cfg.price_throttle_seconds)
        interest = sync_short_interest(client, symbol_map, lookback_days=60)

    sales_written = upsert_short_sales(client, sales)
    interest_written = upsert_short_interest(client, interest)
    logger.info(
        f"sync-shorts done — {sales_written} daily + {interest_written} bi-weekly rows"
    )


@main.command("all")
def sync_all() -> None:
    """Run every sync command in sequence: prices → quotes → fundamentals → analytics → indexes → shorts."""
    for cmd in (
        "sync-prices",
        "sync-quotes",
        "sync-fundamentals",
        "sync-analytics",
        "sync-indexes",
        "sync-shorts",
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