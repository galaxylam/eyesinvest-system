"""Regression tests for the NaN-OHLC filter in `fetch_daily_history`.

yfinance occasionally returns NaN for OHLC fields on newly-listed stocks,
delisted tickers, or rows with no trades that day. These must NOT reach
Supabase — stdlib `json.dumps` rejects NaN and would abort the whole
500-bar upsert chunk.

We patch `yf.Ticker` with a list-backed fake so the test doesn't hit the
network. The returned DataFrame mixes valid rows with NaN rows;
`fetch_daily_history` should keep the valid rows and skip the bad ones
(logging a warning).
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import pytest

from eyesinvest_worker.providers import yfinance as yf_provider


class _FakeTicker:
    """Stand-in for `yf.Ticker`. The test fills `FakeTicker.frame` per-test."""

    frame: pd.DataFrame = pd.DataFrame()

    def __init__(self, _ticker: str):
        pass

    def history(self, **_kwargs: Any) -> pd.DataFrame:
        return _FakeTicker.frame


@pytest.fixture
def fake_yf(monkeypatch: pytest.MonkeyPatch):
    """Patch `yf.Ticker` and yield the fake so tests can set `.frame`."""
    monkeypatch.setattr(yf_provider.yf, "Ticker", _FakeTicker)
    _FakeTicker.frame = pd.DataFrame()
    yield _FakeTicker
    _FakeTicker.frame = pd.DataFrame()


def _build_frame(rows: list[tuple[str, float, float, float, float, int]]) -> pd.DataFrame:
    """Build a DataFrame matching the yfinance `history()` shape."""
    data = [
        {"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}
        for d, o, h, l, c, v in rows
    ]
    df = pd.DataFrame(
        data,
        index=pd.DatetimeIndex([d for d, *_ in rows], name="Date"),
    )
    return df


def test_nan_ohlc_rows_are_dropped(fake_yf):
    fake_yf.frame = _build_frame([
        ("2026-08-20", 10.0, 11.0, 9.5, 10.8, 1_000_000),       # ok
        ("2026-08-21", float("nan"), 11.0, 9.5, 10.8, 1_000_000),  # NaN open
        ("2026-08-24", 10.0, 11.0, 9.5, 10.8, 1_000_000),       # ok
    ])
    bars = yf_provider.fetch_daily_history(
        stock_id="stock-1", symbol="NAN1", currency="USD", years=1
    )
    assert len(bars) == 2
    assert [b.trade_date.isoformat() for b in bars] == ["2026-08-20", "2026-08-24"]


def test_nan_close_only_is_dropped(fake_yf):
    fake_yf.frame = _build_frame([
        ("2026-08-20", 10.0, 11.0, 9.5, float("nan"), 1_000_000),
    ])
    bars = yf_provider.fetch_daily_history(
        stock_id="stock-1", symbol="NAN1", currency="USD", years=1
    )
    assert bars == []


def test_all_nan_returns_empty_no_crash(fake_yf):
    """Pure-NaN frame must return [] cleanly rather than blowing up on
    model_dump(mode='json') → stdlib json.dumps('nan')."""
    fake_yf.frame = _build_frame([
        ("2026-08-20", float("nan"), float("nan"), float("nan"), float("nan"), 0),
        ("2026-08-21", float("nan"), float("nan"), float("nan"), float("nan"), 0),
    ])
    bars = yf_provider.fetch_daily_history(
        stock_id="stock-1", symbol="NAN1", currency="USD", years=1
    )
    assert bars == []


def test_inf_ohlc_rows_are_dropped(fake_yf):
    """Inf is also non-finite — should be treated like NaN."""
    fake_yf.frame = _build_frame([
        ("2026-08-20", 10.0, 11.0, 9.5, float("inf"), 1_000_000),
        ("2026-08-21", 10.0, 11.0, 9.5, 10.8, 1_000_000),
    ])
    bars = yf_provider.fetch_daily_history(
        stock_id="stock-1", symbol="INF1", currency="USD", years=1
    )
    assert len(bars) == 1
    assert bars[0].trade_date.isoformat() == "2026-08-21"


def test_zero_volume_is_kept(fake_yf):
    """A row with valid OHLC but volume=0 is real (no-trade day) — keep it."""
    fake_yf.frame = _build_frame([
        ("2026-08-20", 10.0, 11.0, 9.5, 10.8, 0),
    ])
    bars = yf_provider.fetch_daily_history(
        stock_id="stock-1", symbol="ZRO1", currency="USD", years=1
    )
    assert len(bars) == 1
    assert bars[0].volume == 0


def test_normal_full_series_passes_through(fake_yf):
    """Sanity — a clean frame with no NaN rows returns all bars untouched."""
    fake_yf.frame = _build_frame([
        ("2026-08-20", 10.0, 11.0, 9.5, 10.8, 1_000_000),
        ("2026-08-21", 10.8, 11.2, 10.6, 11.0, 1_100_000),
        ("2026-08-24", 11.0, 11.5, 10.9, 11.3, 1_200_000),
    ])
    bars = yf_provider.fetch_daily_history(
        stock_id="stock-1", symbol="OK01", currency="USD", years=1
    )
    assert len(bars) == 3
    assert bars[0].close == 10.8
    assert bars[2].volume == 1_200_000