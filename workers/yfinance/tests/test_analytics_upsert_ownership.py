"""Regression test: analytics writers must not blank columns they don't own.

`ey_stock_analytics` is written by three commands (sync-analytics,
sync-squeeze, sync-sector-strength), each of which computes only part of the
row. PostgREST's upsert replaces every column present in the payload, so a
writer that sends a null for a column it does not own wipes the value another
writer stored.

That is how `sync-sector-strength` used to erase the squeeze columns that
`sync-squeeze` had just written — for every row inside its 252-day lookback
window, which left the live screener with a squeeze score missing 55% of its
weight (DTC + SI-change) and a max score of 33.6.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from eyesinvest_worker.db.supabase import upsert_analytics_rows  # noqa: E402
from eyesinvest_worker.models import SQUEEZE_COLUMNS, StockAnalyticsRow  # noqa: E402


class _FakeResponse:
    data: list[dict] = []


class _FakeClient:
    """Captures the upsert payload instead of hitting the database."""

    def __init__(self) -> None:
        self.chunks: list[list[dict]] = []
        self.kwargs: list[dict] = []

    def table(self, _name: str) -> "_FakeClient":
        return self

    def upsert(self, chunk: list[dict], **kwargs: object) -> "_FakeClient":
        self.chunks.append(chunk)
        self.kwargs.append(kwargs)
        return self

    def execute(self) -> _FakeResponse:
        return _FakeResponse()


def _row(stock_id: str = "s1", as_of: str = "2026-10-21") -> StockAnalyticsRow:
    return StockAnalyticsRow(
        stock_id=stock_id,
        as_of_date=as_of,
        ma5=10.0,
        ma20=9.5,
        squeeze_score=15.6,  # degraded: computed without short inputs
        squeeze_dtc=None,
        squeeze_si_chg_1w=None,
        squeeze_drawdown_30d=-0.12,
        squeeze_volume_spike=1.1,
        squeeze_am_ratio=None,
        relative_strength=None,
        volume_efficiency=None,
    )


def test_exclude_columns_drops_them_from_every_payload_row() -> None:
    client = _FakeClient()
    upsert_analytics_rows(
        client, [_row("s1", "2026-10-21"), _row("s1", "2026-10-22")],
        exclude_columns=SQUEEZE_COLUMNS,
    )
    assert len(client.chunks) == 1
    for payload_row in client.chunks[0]:
        for col in SQUEEZE_COLUMNS:
            assert col not in payload_row
        # the columns this writer does own are still sent
        assert payload_row["ma5"] == 10.0
        assert payload_row["stock_id"] == "s1"
    # all rows in one batch must carry the same key set for PostgREST
    key_sets = {frozenset(r) for r in client.chunks[0]}
    assert len(key_sets) == 1


def test_preserve_existing_switches_postgrest_to_coalesce_semantics() -> None:
    client = _FakeClient()
    upsert_analytics_rows(client, [_row()], preserve_existing=True)
    assert client.kwargs[0]["default_to_null"] is False

    client = _FakeClient()
    upsert_analytics_rows(client, [_row()])
    assert client.kwargs[0]["default_to_null"] is True


def test_squeeze_columns_constant_matches_the_model() -> None:
    fields = StockAnalyticsRow.model_fields
    for col in SQUEEZE_COLUMNS:
        assert col in fields, f"{col} is not a StockAnalyticsRow field"
    assert len(SQUEEZE_COLUMNS) == 6


@pytest.mark.parametrize("bad", ["ma5", "stock_id", "as_of_date"])
def test_squeeze_columns_never_contain_a_key_column(bad: str) -> None:
    """Excluding a key column would break the upsert conflict target."""
    assert bad not in SQUEEZE_COLUMNS
