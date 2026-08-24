"""Tests for `_sanitize_for_json` — the recursive NaN/Inf → None rewriter.

NaN values reach the upsert layer whenever a provider (yfinance in
practice) returns a non-finite float for an OHLC field, a close, a
share count, etc. Supabase's stdlib JSON encoder rejects NaN, so we
walk the dumped payload and rewrite non-finite floats to None. The
column lands as NULL — the right semantic for "this field is unknown".
"""

from __future__ import annotations

import math

from eyesinvest_worker.db.supabase import _sanitize_for_json


def test_finite_floats_unchanged():
    assert _sanitize_for_json(1.5) == 1.5
    assert _sanitize_for_json(-3.14) == -3.14
    assert _sanitize_for_json(0.0) == 0.0


def test_nan_becomes_none():
    assert _sanitize_for_json(float("nan")) is None


def test_pos_inf_becomes_none():
    assert _sanitize_for_json(float("inf")) is None


def test_neg_inf_becomes_none():
    assert _sanitize_for_json(float("-inf")) is None


def test_non_float_passthrough():
    """Strings, ints, bools, None, dates, datetimes are unchanged."""
    assert _sanitize_for_json("hello") == "hello"
    assert _sanitize_for_json(42) == 42
    assert _sanitize_for_json(True) is True
    assert _sanitize_for_json(None) is None


def test_dict_recursively_sanitised():
    payload = {
        "open": 10.0,
        "high": float("nan"),
        "low": 9.5,
        "close": float("inf"),
        "volume": 1_000_000,
        "currency": "USD",
    }
    out = _sanitize_for_json(payload)
    assert out == {
        "open": 10.0,
        "high": None,
        "low": 9.5,
        "close": None,
        "volume": 1_000_000,
        "currency": "USD",
    }


def test_list_recursively_sanitised():
    payload = [1.0, float("nan"), "USD", 0]
    assert _sanitize_for_json(payload) == [1.0, None, "USD", 0]


def test_nested_structures():
    """Bars → list of {field: float}. One nested NaN inside one bar."""
    payload = [
        {"trade_date": "2026-08-20", "close": 10.0, "volume": 1000},
        {"trade_date": "2026-08-21", "close": float("nan"), "volume": 2000},
    ]
    out = _sanitize_for_json(payload)
    assert out[0]["close"] == 10.0
    assert out[1]["close"] is None
    assert out[1]["volume"] == 2000


def test_result_is_json_dumps_compliant():
    """The whole point: output must be serialisable by stdlib json.dumps
    without raising. Run a representative shape end-to-end."""
    import json

    payload = [
        {"open": float("nan"), "close": 10.0, "high": float("inf")},
        {"open": 5.0, "close": float("nan"), "high": 5.5},
    ]
    sanitised = _sanitize_for_json(payload)
    # No NaN / Inf should remain — stdlib's json.dumps would otherwise raise
    # "Out of range float values are not JSON compliant".
    serialised = json.dumps(sanitised)
    assert serialised  # non-empty
    assert "NaN" not in serialised
    assert "Infinity" not in serialised