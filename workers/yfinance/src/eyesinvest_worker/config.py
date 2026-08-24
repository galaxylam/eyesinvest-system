"""Worker configuration loaded from environment variables."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def hk_stock_symbol_to_code(symbol: str) -> int | None:
    """Map an `ey_stocks.symbol` to the numeric HKEX 5-digit stock code.

    Examples:
        "0700.HK"  -> 700
        "0001.HK"  -> 1
        "12345.HK" -> 12345
        "AAPL"     -> None   (not an HK symbol)
        "0700"     -> None   (missing suffix)
    """
    if not symbol.endswith(".HK"):
        return None
    digits = symbol[:-3]
    if not digits.isdigit():
        return None
    return int(digits)


class WorkerConfig(BaseSettings):
    """Reads from .env (CWD) and process environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    supabase_url: str = Field(..., alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(..., alias="SUPABASE_SERVICE_ROLE_KEY")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # FINRA Developer API — both optional; sync-shorts falls back to the
    # public CDN when either is missing.
    finra_api_client_id: str | None = Field(default=None, alias="FINRA_API_CLIENT_ID")
    finra_api_secret: str | None = Field(default=None, alias="FINRA_API_SECRET")
    # How many trailing calendar days of `regShoDaily` to pull per ticker.
    # 90 ≈ three months of trading days, enough for the 3M picker window.
    # 1 ticker × 90 days = ~63 rows, well under FINRA's 5,000-row per-call
    # cap. Bump if you want a longer daily bar history on the chart.
    short_sale_history_days: int = Field(default=90, alias="SHORT_SALE_HISTORY_DAYS")

    # How long to pause between ticker fetches, in seconds.
    price_throttle_seconds: float = 0.5
    info_throttle_seconds: float = 1.0
    # How many years of daily bars to pull per ticker. Bumped from 2 → 3 so
    # MA200 / 1y return / 3y drawdown all have enough history to populate.
    history_period_years: int = 3

    # HK shorts — knobs for the HKEX daily + SFC weekly paths in sync-shorts.
    # HKEX public page only carries the current day's aggregate, so the
    # history-days knob is mostly defensive (worker only ever fetches today).
    hkex_short_sale_history_days: int = Field(
        default=5, alias="HK_SHORTS_HISTORY_DAYS"
    )
    # How many SFC weekly CSVs to backfill on first-ever run. Default 180
    # days ≈ 26 weeks ≈ ~6 months; raise to fetch the full 2012-09-14 →
    # present archive in one shot.
    sfc_backfill_days: int = Field(default=180, alias="SFC_BACKFILL_DAYS")
    # Force a full SFC backfill on the next sync-shorts run, even if rows
    # already exist. Set via env var SHORTS_FORCE_SFC_BACKFILL=1.
    shorts_force_sfc_backfill: bool = Field(
        default=False, alias="SHORTS_FORCE_SFC_BACKFILL"
    )

    # Phase 3+ sector-strength: how many calendar days of price history to
    # keep per stock when computing volume_efficiency / crowded_ratio /
    # trailing returns. 252 ≈ 1y trading days, which is the longest
    # window used by the sector rollup. Older bars are trimmed before the
    # analytics pass so we don't churn over 3y of data unnecessarily.
    sector_strength_lookback_days: int = Field(
        default=252, alias="SECTOR_STRENGTH_LOOKBACK_DAYS"
    )
