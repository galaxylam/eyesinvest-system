"""Click CLI entry point — `python -m eyesinvest_worker <subcommand>`."""

from __future__ import annotations

import time

import click

from eyesinvest_worker import __version__
from eyesinvest_worker.config import WorkerConfig, hk_stock_symbol_to_code
from eyesinvest_worker.db import (
    fetch_active_stocks,
    fetch_last_settlement_date,
    fetch_latest_short_interest,
    fetch_latest_short_sale,
    fetch_price_history,
    make_client,
    upsert_analytics_rows,
    upsert_fundamentals,
    upsert_index_quotes,
    upsert_price_bars,
    upsert_quote_snapshot,
    upsert_sector_daily,
    upsert_short_interest,
    upsert_short_sales,
)
from eyesinvest_worker.log import configure_logging, logger
from eyesinvest_worker.models import Fundamentals, IndexQuote
from eyesinvest_worker.providers import (
    compute_analytics,
    compute_news,
    compute_sector_strength,
    fetch_daily_history,
    fetch_fundamentals,
    fetch_index_quote,
    fetch_quote_snapshot,
    sync_hkex_short_sales,
    sync_hkex_short_sales_combined,
    sync_sfc_short_interest,
    sync_short_interest,
    sync_short_sales,
)
from eyesinvest_worker.providers.analytics import ShortInterestInput
from eyesinvest_worker.providers.finra_api import (
    FinraApiError,
    FinraClient,
    sync_short_interest_via_api,
    sync_short_sales_via_api,
)

# Stable iteration order so the `all` command is reproducible.
_INDEX_CODES = ("SPX", "HSI")

# Shared --market option for per-stock sync commands. Used to split US / HK
# runs so a single invocation only touches one market end-to-end.
_MARKET_OPTION = click.option(
    "--market",
    type=click.Choice(["all", "us", "hk"], case_sensitive=False),
    default="all",
    show_default=True,
    help=(
        "Restrict the run to one market. 'all' (default) updates US + HK; "
        "'us' skips HK stocks; 'hk' skips US stocks. "
        "Useful when one side is slow / rate-limited / already up-to-date."
    ),
)


def _filter_by_market(stocks: list, market: str) -> list:
    """In-memory filter for `fetch_active_stocks` by `s.market`.

    `market` is the lower-cased CLI value ("all" / "us" / "hk"). Defensive
    cast — callers pass user input straight from click.
    """
    market = (market or "all").lower()
    if market == "all":
        return stocks
    target = market.upper()  # ey_stocks.market stores 'US' / 'HK'
    return [s for s in stocks if s.market == target]


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
@_MARKET_OPTION
def sync_prices(market: str) -> None:
    """Pull 2-year daily OHLC for every active stock."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = _filter_by_market(fetch_active_stocks(client), market)
    logger.info(f"syncing daily OHLC for {len(stocks)} stocks (market={market})")

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
@_MARKET_OPTION
def sync_quotes(market: str) -> None:
    """Compute the latest per-stock quote snapshot."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = _filter_by_market(fetch_active_stocks(client), market)
    logger.info(f"computing quote snapshots for {len(stocks)} stocks (market={market})")

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
@_MARKET_OPTION
def sync_fundamentals(market: str) -> None:
    """Pull .info metrics for every active stock."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = _filter_by_market(fetch_active_stocks(client), market)
    logger.info(f"syncing fundamentals for {len(stocks)} stocks (market={market})")

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
@_MARKET_OPTION
def sync_analytics(market: str) -> None:
    """Compute MA / RSI / MACD / volatility / drawdown / returns for every stock."""
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = _filter_by_market(fetch_active_stocks(client), market)
    logger.info(f"computing analytics for {len(stocks)} stocks (market={market})")

    total = 0
    for i, s in enumerate(stocks, start=1):
        rows = fetch_price_history(client, s.id)
        if not rows:
            logger.warning(f"[{i}/{len(stocks)}] {s.symbol}: no price history")
            continue
        result = compute_analytics(stock_id=s.id, bars=rows)
        if result and result.rows:
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
@click.option(
    "--market",
    type=click.Choice(["all", "us", "hk"], case_sensitive=False),
    default="all",
    show_default=True,
    help=(
        "Restrict the run to one market. 'all' (default) syncs US + HK; "
        "'us' skips HKEX + SFC; 'hk' skips the entire FINRA path. "
        "Useful when one side is slow / rate-limited / already up-to-date."
    ),
)
def sync_shorts(market: str) -> None:
    """Pull short-selling data for every tracked stock across US + HK.

    US path:
        FINRA `regShoDaily` + `consolidatedShortInterest`. API path is
        used when both FINRA_API_CLIENT_ID + SECRET are set; otherwise
        the public CDN TXT files are used.

    HK daily:
        Scrape HKEX's public `ASHTMAIN.HTM` pages (Main Board + GEM)
        once each. The page is only populated after HK market close
        (16:00 HKT); we tolerate the placeholder gracefully.

    HK weekly:
        SFC weekly CSVs of aggregated reportable short positions. Reads
        the SFC index page, downloads each CSV newer than the highest
        `settlement_date` already stored — first-ever run backfills
        SFC_BACKFILL_DAYS (default 180).

    Failures are logged + skipped rather than aborting the run.
    """
    from datetime import date as _date

    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = fetch_active_stocks(client)
    # Defense-in-depth: even if `ey_stocks.market` is wrong for a row
    # (e.g. a 1024.HK mistakenly inserted as market='US'), never let an HK
    # symbol reach FINRA — it only covers US tickers, so the query gets a
    # persistent empty body and wastes a round-trip. The HK path picks up
    # the same ticker once its `market` is corrected to 'HK'.
    us_stocks = [s for s in stocks if s.market == "US" and not s.symbol.upper().endswith(".HK")]
    hk_stocks = [s for s in stocks if s.market == "HK"]
    us_symbol_map = {s.symbol: s.id for s in us_stocks}
    hk_code_to_id = {
        code: stock_id
        for code, stock_id in (
            (hk_stock_symbol_to_code(s.symbol), s.id) for s in hk_stocks
        )
        if code is not None
    }
    if dropped := [s.symbol for s in stocks if s.market == "US" and s.symbol.upper().endswith(".HK")]:
        logger.warning(
            f"sync-shorts: {len(dropped)} HK-looking symbol(s) stored with "
            f"market='US' are excluded from the US path: {dropped}"
        )
    logger.info(
        f"syncing short-selling for {len(us_stocks)} US + "
        f"{len(hk_stocks)} HK stocks ({len(hk_code_to_id)} HK codes known)"
    )

    market_lower = market.lower()
    skip_us = market_lower == "hk"
    skip_hk = market_lower == "us"
    if skip_us:
        logger.info("--market=hk: skipping FINRA / US path entirely")
    if skip_hk:
        logger.info("--market=us: skipping HKEX + SFC / HK path entirely")

    use_api = bool(cfg.finra_api_client_id and cfg.finra_api_secret)
    us_sales: list = []
    us_interest: list = []
    days = cfg.short_sale_history_days

    if not skip_us:
        if use_api:
            logger.info("US: using authenticated FINRA Developer API")
            api = FinraClient(cfg.finra_api_client_id or "", cfg.finra_api_secret or "")
            try:
                us_sales = sync_short_sales_via_api(api, us_symbol_map, days=days)
                us_interest = sync_short_interest_via_api(api, us_symbol_map)
            except FinraApiError as exc:
                logger.warning(
                    f"FINRA API path failed ({exc}); falling back to public CDN"
                )
                us_sales = sync_short_sales(client, us_symbol_map, days=days)
                time.sleep(cfg.price_throttle_seconds)
                us_interest = sync_short_interest(client, us_symbol_map, lookback_days=60)
        else:
            logger.info("US: FINRA_API_CLIENT_ID/SECRET not set; using public CDN")
            us_sales = sync_short_sales(client, us_symbol_map, days=days)
            time.sleep(cfg.price_throttle_seconds)
            us_interest = sync_short_interest(client, us_symbol_map, lookback_days=60)

    # --- HK ---
    hk_sales: list = []
    hk_interest: list = []
    if hk_stocks and not skip_hk:
        hk_sales = sync_hkex_short_sales_combined(client, hk_code_to_id)
        time.sleep(cfg.price_throttle_seconds)
        last_iso = fetch_last_settlement_date(client, market="HK")
        last_settlement = _date.fromisoformat(last_iso) if last_iso else None
        hk_interest = sync_sfc_short_interest(
            client,
            hk_code_to_id,
            last_settlement=last_settlement,
            backfill_days=cfg.sfc_backfill_days,
            force_backfill=cfg.shorts_force_sfc_backfill,
        )

    us_sales_written = upsert_short_sales(client, us_sales)
    us_interest_written = upsert_short_interest(client, us_interest)
    if hk_sales or hk_interest:
        logger.info(
            f"HK upserts: {len(hk_sales)} daily → ey_short_sale_1d, "
            f"{len(hk_interest)} weekly → ey_short_interest"
        )
    hk_sales_written = upsert_short_sales(client, hk_sales)
    hk_interest_written = upsert_short_interest(client, hk_interest)
    logger.info(
        f"sync-shorts done — US {us_sales_written}d / {us_interest_written}w, "
        f"HK {hk_sales_written}d / {hk_interest_written}w"
    )


@main.command("sync-sector-strength")
def sync_sector_strength() -> None:
    """Compute per-stock sector metrics + sector-level rollup.

    Pass A: per-stock analytics update — writes volume_efficiency,
    crowded_ratio, relative_strength onto ey_stock_analytics (same PK as
    sync-analytics so reruns overwrite cleanly).

    Pass B: sector aggregation — groups today's per-stock rows by sector
    and writes member_count / breadth_pct / sector_return_N /
    rs_vs_market_N / mean efficiency / mean crowded onto ey_sector_daily.

    Market benchmark (SPX/HSI trailing returns) is refetched in-memory via
    yfinance. Per-stock failures or yfinance failures log a warning and
    leave affected columns null rather than aborting the run.
    """
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)

    result = compute_sector_strength(client, cfg)
    n_stock = upsert_analytics_rows(client, result.analytics_rows) if result.analytics_rows else 0
    n_sector = upsert_sector_daily(client, result.sector_rows) if result.sector_rows else 0
    logger.info(
        f"sync-sector-strength done — {n_stock} stock rows, {n_sector} sector rows"
    )


@main.command("sync-news")
@click.option("--skip-llm", is_flag=True, help="Discover + write articles only; skip OpenRouter pass.")
@click.option("--limit", "article_limit", type=int, default=None, help="Override NEWS_MAX_ARTICLES_PER_RUN for this run.")
def sync_news_cmd(skip_llm: bool, article_limit: int | None) -> None:
    """RSS discovery + body crawl + OpenRouter analysis; write pending rows.

    Pass A runs RSS feeds (NEWS_RSS_FEEDS) to discover article URLs,
    then fetches each article's full body via trafilatura and upserts
    into ey_news_article. Dedup is on source_url (UNIQUE).

    Pass B runs when OPENROUTER_API_KEY is set (and --skip-llm is not):
    bundle fresh articles into batches, call the configured OpenRouter
    model with a JSON response format, parse out per-article impact
    analysis (ey_news_stock_mapping) and stock<->stock edges
    (ey_stock_relationship). Both land as status='pending' — an admin
    approves them via apps/admin/news.

    Without --skip-llm / --limit, the knobs come from WorkerConfig
    (NEWS_RSS_FEEDS, NEWS_LOOKBACK_HOURS, NEWS_CRAWL_BODY_ENABLED,
    OPENROUTER_MODEL, etc).
    """
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)

    if article_limit is not None:
        cfg.news_max_articles_per_run = article_limit

    result = compute_news(client, cfg, skip_llm=skip_llm)
    logger.info(
        f"sync-news done — {result.articles_written} articles, "
        f"{result.mappings_written} mappings, "
        f"{result.relationships_written} relationships written "
        f"({result.skipped_seen} already seen, "
        f"{result.failed_llm_batches} LLM batch(es) failed)"
    )


@main.command("sync-squeeze")
@_MARKET_OPTION
def sync_squeeze(market: str) -> None:
    """Compute the short-squeeze score per stock and upsert onto ey_stock_analytics.

    Reads ``ey_price_1d`` (30d ADV for DTC), ``ey_short_interest`` (DTC +
    SI Δ 1W), and the most-recent ``ey_short_sale_1d`` row (HK AM-ratio).
    Runs after ``sync-analytics`` (price history fresh) and ``sync-shorts``
    (short-interest + AM fresh). See ``docs/SQUEEZE.md`` for the formula.

    Stock-level squeeze inputs (``short_interest_rows``,
    ``latest_short_sale``) are passed to ``compute_analytics``; the
    per-row ``StockAnalyticsRow`` carries 6 nullable squeeze columns plus
    the latest composite ``squeeze_score``. Upsert uses the existing
    ``upsert_analytics_rows`` path — PostgREST partial-row upsert leaves
    other columns untouched.
    """
    cfg = _load_config()
    configure_logging(cfg.log_level)
    client = make_client(cfg.supabase_url, cfg.supabase_service_role_key)
    stocks = _filter_by_market(fetch_active_stocks(client), market)
    logger.info(f"computing squeeze scores for {len(stocks)} stocks (market={market})")

    total = 0
    scored = 0
    for i, s in enumerate(stocks, start=1):
        rows = fetch_price_history(client, s.id)
        if not rows:
            logger.warning(f"squeeze [{i}/{len(stocks)}] {s.symbol}: no price history")
            continue
        si_rows = fetch_latest_short_interest(client, s.id, limit=2)
        sale_row = fetch_latest_short_sale(client, s.id)
        si_inputs = [
            ShortInterestInput(
                short_interest=r["short_interest"],
                prior_short_interest=r.get("prior_short_interest"),
                change_pct=r.get("change_pct"),
            )
            for r in si_rows
        ]
        latest_sale = (
            (sale_row.get("am_short_volume"), sale_row.get("short_volume"))
            if sale_row
            else None
        )
        result = compute_analytics(
            stock_id=s.id,
            bars=rows,
            short_interest_rows=si_inputs,
            latest_short_sale=latest_sale,
        )
        if result and result.rows:
            total += upsert_analytics_rows(client, result.rows)
            score = result.rows[-1].squeeze_score
            if score is not None:
                scored += 1
            logger.info(
                f"squeeze [{i}/{len(stocks)}] {s.symbol}: "
                f"score={score if score is not None else 'n/a'}"
            )
        else:
            logger.warning(f"squeeze [{i}/{len(stocks)}] {s.symbol}: no analytics rows")
        time.sleep(cfg.price_throttle_seconds)

    logger.info(
        f"sync-squeeze done — {total} indicator rows written, "
        f"{scored} stocks with a numeric score"
    )


@main.command("all")
def sync_all() -> None:
    """Run every sync command for US + HK in sequence.

    Convenience entry point for "refresh everything". Per-market splits
    live in `all-us` / `all-hk`.
    """
    _run_pipeline(market="all")


@main.command("all-us")
def sync_all_us() -> None:
    """Run every sync command for US stocks only.

    Same pipeline as `all`, but each per-stock step gets `--market=us`,
    so HK stocks are skipped end-to-end. `sync-indexes` (SPX+HSI) and
    `sync-sector-strength` (global rollup) still run as-is.
    """
    _run_pipeline(market="us")


@main.command("all-hk")
def sync_all_hk() -> None:
    """Run every sync command for HK stocks only.

    Same pipeline as `all`, but each per-stock step gets `--market=hk`,
    so US stocks are skipped end-to-end. `sync-indexes` (SPX+HSI) and
    `sync-sector-strength` (global rollup) still run as-is.
    """
    _run_pipeline(market="hk")


def _run_pipeline(market: str) -> None:
    """Run the full per-market sync pipeline in order.

    `market` is passed through to every per-stock command via
    `--market=<market>`. `sync-indexes` and `sync-sector-strength`
    don't accept a market filter (they aggregate across US + HK
    intentionally) and run unchanged.

    `sync-news` is intentionally excluded — run it explicitly via
    `uv run python -m eyesinvest_worker sync-news` until the news + AI
    workflow has been reviewed and approved.
    """
    market_label = (market or "all").lower()
    # Commands that filter per-stock by --market. The rest run as-is.
    per_market_cmds = (
        "sync-prices",
        "sync-quotes",
        "sync-fundamentals",
        "sync-analytics",
        "sync-shorts",
        "sync-squeeze",
    )
    aggregate_cmds = (
        "sync-indexes",
        "sync-sector-strength",
    )
    logger.info(f"=== pipeline start (market={market_label}) ===")
    for cmd in per_market_cmds + aggregate_cmds:
        if cmd in per_market_cmds:
            args = [cmd, f"--market={market_label}"]
            log_cmd = f"{cmd} (--market={market_label})"
        else:
            args = [cmd]
            log_cmd = f"{cmd} (market-agnostic)"
        logger.info(f"=== {log_cmd} ===")
        # Re-invoke this CLI in-process so config + logging re-init cleanly.
        rc = cli_main(args)
        if rc != 0:
            raise click.ClickException(f"{cmd} failed (exit {rc})")
    logger.info(f"=== pipeline done (market={market_label}) ===")


def cli_main(args: list[str]) -> int:
    """Helper for `_run_pipeline` — return exit code instead of calling sys.exit."""
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