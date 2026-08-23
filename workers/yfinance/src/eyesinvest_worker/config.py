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

    # How long to pause between ticker fetches, in seconds.
    price_throttle_seconds: float = 0.5
    info_throttle_seconds: float = 1.0
    # How many years of daily bars to pull per ticker. Bumped from 2 → 3 so
    # MA200 / 1y return / 3y drawdown all have enough history to populate.
    history_period_years: int = 3
