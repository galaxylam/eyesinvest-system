"""Pure-Python tests for the green/red impact-ease helper.

`_green_red_impact_ease_1m` captures the classical "1 dollar pushes X% up
vs Y% down" theory: how efficiently does buying volume move the price up
vs selling volume move it down, over a 21-day window. Returns a SIGNED
ease score in [-1, 1]: +1 means buyers had a much easier time, -1 means
sellers.

Sibling to `_green_red_volume_share_1m` (effort distribution) — ease
measures push efficiency instead. Default window is 21 trading days to
match the stocks page Range picker "1M" so the screener and the
stocks-page pill agree. NaN when the window has no up or no down bars,
or when both impacts are zero (degenerate window).

These tests cover the helper in isolation — no HTTP / Supabase.
"""

import math

import pandas as pd

from eyesinvest_worker.providers.analytics import _green_red_impact_ease_1m


def _bars(rows: list[tuple[float, float, float, float]]) -> pd.DataFrame:
    """Build a DataFrame of (open, close, volume, _unused) tuples."""
    return pd.DataFrame(rows, columns=["open", "close", "volume", "_"])


def test_all_up_ease_is_one():
    # 5 up-days, each close > open. Only up-side has impact; down_impact = 0.
    # ease = (up - 0) / (up + 0) = +1
    bars = _bars([
        (100, 110, 1000, 0),
        (100, 105,  500, 0),
        (100, 108,  700, 0),
        (100, 102,  300, 0),
        (100, 115, 1500, 0),
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isclose(float(s.iloc[-1]), 1.0, abs_tol=1e-9)


def test_all_down_ease_is_minus_one():
    # 5 down-days, only down-side has impact. ease = (0 - down) / (0 + down) = -1
    bars = _bars([
        (110, 100, 1000, 0),
        (105, 100,  500, 0),
        (108, 100,  700, 0),
        (102, 100,  300, 0),
        (115, 100, 1500, 0),
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isclose(float(s.iloc[-1]), -1.0, abs_tol=1e-9)


def test_symmetric_impact_ease_is_zero():
    # Up day: +$10 on 1000 vol → impact = 0.01
    # Down day: −$10 on 1000 vol → impact = 0.01
    # Same impact per dollar on both sides → ease = 0
    bars = _bars([
        (100, 110, 1000, 0),  # green
        (110, 100, 1000, 0),  # red
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=2)
    assert math.isclose(float(s.iloc[-1]), 0.0, abs_tol=1e-9)


def test_asymmetric_ease_matches_ratio():
    # Up day: +$10 on 1000 vol → up_impact = 0.01
    # Down day: −$10 on 500 vol  → down_impact = 0.02 (more efficient push down)
    # ease = (0.01 - 0.02) / (0.01 + 0.02) = -1/3
    bars = _bars([
        (100, 110, 1000, 0),  # green
        (110, 100,  500, 0),  # red, more impactful per dollar
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=2)
    assert math.isclose(float(s.iloc[-1]), -1 / 3, abs_tol=1e-9)


def test_doji_excluded_from_both_sides():
    # 1 green (+$10, 1000 vol) + 1 doji (ignored) + 1 red (−$10, 500 vol)
    # Same as test_asymmetric_ease with a doji in the middle — ease = -1/3.
    bars = _bars([
        (100, 110, 1000, 0),  # green
        (100, 100,  999, 0),  # doji
        (110, 100,  500, 0),  # red, more impactful per dollar
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=3)
    assert math.isclose(float(s.iloc[-1]), -1 / 3, abs_tol=1e-9)


def test_short_window_returns_nan():
    # window=5 but only 4 bars → rolling sum has NaN at last row.
    bars = _bars([
        (100, 110, 1000, 0),
        (100, 105,  500, 0),
        (100, 108,  700, 0),
        (100, 102,  300, 0),
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isnan(float(s.iloc[-1]))


def test_window_all_doji_returns_nan():
    # No up/down bars → both impacts NaN → result NaN.
    bars = _bars([
        (100, 100, 1000, 0),
        (100, 100,  500, 0),
        (100, 100,  700, 0),
        (100, 100,  300, 0),
        (100, 100, 1500, 0),
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isnan(float(s.iloc[-1]))


def test_degenerate_window_zero_price_change_returns_nan():
    # Both sides present but no price change on either → both impacts = 0
    # → total_impact = 0 → NaN. Degenerate, not "perfectly symmetric".
    bars = _bars([
        (100, 100, 1000, 0),  # doji (close == open)
        (100, 100, 1000, 0),  # doji
        (100, 100, 1000, 0),  # doji
        (100, 100, 1000, 0),  # doji
        (100, 100, 1000, 0),  # doji
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isnan(float(s.iloc[-1]))


def test_rolling_window_advances_correctly():
    # 6 bars, window=3. The last 3 bars form the test window:
    #   green (+5 on 100), red (−10 on 200), green (+5 on 100)
    #   up_move_sum = 5 + 5 = 10, green_vol_sum = 100 + 100 = 200 → up_impact = 0.05
    #   down_move_sum = 10, red_vol_sum = 200 → down_impact = 0.05
    #   ease = 0 (symmetric).
    bars = _bars([
        (100, 110, 1000, 0),
        (110, 100, 1000, 0),
        (100, 110, 1000, 0),
        (100, 105,  100, 0),  # window[-3] — green
        (105,  95,  200, 0),  # window[-2] — red
        ( 95, 100,  100, 0),  # window[-1] — green
    ])
    s = _green_red_impact_ease_1m(bars["open"], bars["close"], bars["volume"], window=3)
    assert math.isclose(float(s.iloc[-1]), 0.0, abs_tol=1e-9)
    assert not math.isnan(float(s.iloc[-1]))
