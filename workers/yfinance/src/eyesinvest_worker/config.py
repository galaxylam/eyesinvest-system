"""Worker configuration loaded from environment variables."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
