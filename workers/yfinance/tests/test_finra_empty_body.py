"""Regression tests for FINRA `_post` empty / non-JSON body handling.

The FINRA Developer API occasionally returns 200 with an empty body (or
HTML) on transient upstream hiccups. The previous code path crashed
the entire ``sync-shorts`` run with a bare ``JSONDecodeError``. The fixed
behavior:

- 2xx with empty body → log + retry once, then raise ``FinraApiError``
- 2xx with non-JSON body → log + retry once, then raise ``FinraApiError``
- HTTPError is unchanged (existing 401-retry path is preserved)

These tests mock ``urllib.request.urlopen`` to drive each scenario
without hitting the real endpoint.
"""

from __future__ import annotations

import io
import json
from typing import Any
from contextlib import contextmanager

import pytest

from eyesinvest_worker.providers import finra_api


class _FakeResponse:
    """Stand-in for the context-manager object returned by ``urlopen``."""

    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *_exc: Any) -> None:
        return None

    def read(self) -> bytes:
        return self._body


@contextmanager
def _patched_urlopen(scripts: list):
    """Replace `urllib.request.urlopen` with a script-driven sequence of
    responses. Each entry is either:
      - a `_FakeResponse` returned directly
      - an `Exception` instance to raise
    """
    it = iter(scripts)

    def fake_urlopen(req, timeout=None):  # noqa: ARG001
        item = next(it)
        if isinstance(item, BaseException):
            raise item
        return item

    import urllib.request
    saved = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen
    try:
        yield
    finally:
        urllib.request.urlopen = saved


def _make_client() -> finra_api.FinraClient:
    return finra_api.FinraClient(client_id="id", client_secret="secret")


def _bypass_token(client: finra_api.FinraClient) -> None:
    """Skip the OAuth dance — inject a cached token directly."""
    client._token = "fake-token"
    client._token_acquired_at = 9e18  # far in the future, won't expire


def test_empty_body_first_attempt_recovers(monkeypatch):
    """Empty body on attempt 1 + valid JSON on attempt 2 → returns the JSON."""
    client = _make_client()
    _bypass_token(client)
    expected = [{"tradeReportDate": "2026-08-24", "shortParQuantity": 100}]
    scripts = [
        _FakeResponse(b""),  # empty body — retry
        _FakeResponse(json.dumps(expected).encode()),  # valid
    ]
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)
    with _patched_urlopen(scripts):
        out = client._post("regShoDaily", {"x": 1})
    assert out == expected


def test_empty_body_both_attempts_raises(monkeypatch):
    """Empty body twice → raises FinraApiError so caller can skip the ticker."""
    client = _make_client()
    _bypass_token(client)
    scripts = [_FakeResponse(b""), _FakeResponse(b"")]
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)
    with _patched_urlopen(scripts):
        with pytest.raises(finra_api.FinraApiError, match="empty body"):
            client._post("regShoDaily", {"x": 1})


def test_non_json_body_first_attempt_recovers(monkeypatch):
    """HTML/non-JSON on attempt 1 + valid JSON on attempt 2 → returns the JSON."""
    client = _make_client()
    _bypass_token(client)
    expected = [{"tradeReportDate": "2026-08-24", "shortParQuantity": 200}]
    scripts = [
        _FakeResponse(b"<html>oops</html>"),  # non-JSON — retry
        _FakeResponse(json.dumps(expected).encode()),
    ]
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)
    with _patched_urlopen(scripts):
        out = client._post("regShoDaily", {"x": 1})
    assert out == expected


def test_non_json_body_both_attempts_raises(monkeypatch):
    """Two non-JSON bodies → raises FinraApiError with the snippet."""
    client = _make_client()
    _bypass_token(client)
    scripts = [_FakeResponse(b"garbage"), _FakeResponse(b"also garbage")]
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)
    with _patched_urlopen(scripts):
        with pytest.raises(finra_api.FinraApiError, match="non-JSON body"):
            client._post("regShoDaily", {"x": 1})


def test_normal_response_passes_through(monkeypatch):
    """Sanity — a clean JSON 2xx response is returned untouched."""
    client = _make_client()
    _bypass_token(client)
    expected = [{"k": "v"}]
    scripts = [_FakeResponse(json.dumps(expected).encode())]
    with _patched_urlopen(scripts):
        out = client._post("regShoDaily", {"x": 1})
    assert out == expected


def test_fetch_reg_sho_daily_skips_failing_ticker(monkeypatch):
    """The per-ticker caller must skip a ticker when _post raises FinraApiError
    on empty body — so one bad ticker doesn't sink the whole sync-shorts run."""
    client = _make_client()
    _bypass_token(client)
    # Ticker A: empty twice → skipped. Ticker B: valid → kept.
    scripts = [
        _FakeResponse(b""),                  # A attempt 1 — empty
        _FakeResponse(b""),                  # A attempt 2 — empty → raise
        _FakeResponse(b'[]'),                # B attempt 1 — valid empty result
    ]
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)
    with _patched_urlopen(scripts):
        from datetime import date
        rows = finra_api.fetch_reg_sho_daily(
            client,
            {"AAPL": "stock-a", "MSFT": "stock-b"},
            date(2026, 8, 20),
            date(2026, 8, 24),
        )
    # AAPL rows were skipped entirely; MSFT returned [].
    assert rows == []


def test_reg_sho_daily_skips_hk_symbol_without_http(monkeypatch):
    """HK-looking symbols must NOT trigger a FINRA round-trip — only US
    tickers in the map should reach `_post`. Regression guard for the case
    where `ey_stocks.market='US'` is mis-stored for a `.HK` symbol: even
    after the CLI filter, defense-in-depth here ensures FINRA never
    receives a query for an HK ticker."""
    client = _make_client()
    _bypass_token(client)

    def _explode_if_called(*_args, **_kwargs):  # noqa: ARG001
        raise AssertionError("FINRA was queried for an HK symbol — guard failed")

    # Patch _post at the class level — if the guard works, this is never reached.
    monkeypatch.setattr(client, "_post", _explode_if_called)
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)

    from datetime import date
    rows = finra_api.fetch_reg_sho_daily(
        client,
        {"1024.HK": "hk-uuid", "0700.HK": "hk-uuid-2"},
        date(2026, 8, 20),
        date(2026, 8, 24),
    )
    assert rows == []


def test_consolidated_short_interest_skips_hk_symbol_without_http(monkeypatch):
    """Same regression guard as above, but for the bi-weekly FINRA dataset."""
    client = _make_client()
    _bypass_token(client)

    def _explode_if_called(*_args, **_kwargs):  # noqa: ARG001
        raise AssertionError("FINRA was queried for an HK symbol — guard failed")

    monkeypatch.setattr(client, "_post", _explode_if_called)
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)

    rows = finra_api.fetch_consolidated_short_interest(
        client,
        {"1024.HK": "hk-uuid", "9868.HK": "hk-uuid-2"},
    )
    assert rows == []


def test_reg_sho_daily_mixed_map_only_queries_us(monkeypatch):
    """A mixed map should query only the US symbols. HK entries are
    skipped silently (just a warning log), and the rest of the map
    continues to be processed normally."""
    client = _make_client()
    _bypass_token(client)

    seen_symbols: list[str] = []

    def _fake_post(_self, dataset, payload):  # noqa: ARG001
        # Capture the symbol field value from the FINRA filter so we can
        # assert HK symbols never made it through.
        for cf in payload.get("compareFilters", []):
            seen_symbols.append(cf["fieldValue"])
        return []

    monkeypatch.setattr(finra_api.FinraClient, "_post", _fake_post)
    monkeypatch.setattr(finra_api.time, "sleep", lambda _s: None)

    from datetime import date
    finra_api.fetch_reg_sho_daily(
        client,
        {"AAPL": "us-uuid-1", "1024.HK": "hk-uuid", "MSFT": "us-uuid-2"},
        date(2026, 8, 20),
        date(2026, 8, 24),
    )
    # 1024.HK must NOT be in the queried set.
    assert "AAPL" in seen_symbols
    assert "MSFT" in seen_symbols
    assert "1024.HK" not in seen_symbols
