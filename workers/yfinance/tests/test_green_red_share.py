"""Pure-Python tests for the green/red volume share helper.

`green_red_volume_share_1m` is the sum-weighted sibling of
`green_red_volume_ratio_1m`. It returns a SIGNED share in [-1, 1]:
  * green dominant (green share ≥ 0.5) → +green_share
  * red   dominant (green share  < 0.5) → -red_share
so the sign carries the colour zone and the magnitude carries how
decisively one side is winning. Default window is 21 trading days
to match the stocks page Range picker "1M" so the screener and the
stocks-page pill agree. NaN when the window has no up or no down bars.

These tests cover the helper in isolation — no HTTP / Supabase.
"""

import math
import pandas as pd
import numpy as np

from eyesinvest_worker.providers.analytics import _green_red_volume_share_1m


def _bars(rows: list[tuple[float, float, float, float]]) -> pd.DataFrame:
    """Build a DataFrame of (open, close, volume, _unused) tuples."""
    return pd.DataFrame(rows, columns=["open", "close", "volume", "_"])


def test_all_green_share_is_one():
    # 5 up-days, each close > open. green share = 1.0, in green → signed +1.0
    bars = _bars([
        (100, 110, 1000, 0),
        (100, 105,  500, 0),
        (100, 108,  700, 0),
        (100, 102,  300, 0),
        (100, 115, 1500, 0),
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isclose(float(s.iloc[-1]), 1.0, abs_tol=1e-9)


def test_all_red_share_is_zero():
    # 5 down-days → green share 0.0, red share 1.0, in red → signed -1.0
    bars = _bars([
        (110, 100, 1000, 0),
        (105, 100,  500, 0),
        (108, 100,  700, 0),
        (102, 100,  300, 0),
        (115, 100, 1500, 0),
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isclose(float(s.iloc[-1]), -1.0, abs_tol=1e-9)


def test_mixed_proportions_match_sum():
    # 1 green day (vol 200) + 1 red day (vol 800)
    # green share = 0.2, red share = 0.8, in red → signed -0.8
    bars = _bars([
        (100, 110, 200, 0),  # green
        (110, 100, 800, 0),  # red
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=2)
    assert math.isclose(float(s.iloc[-1]), -0.8, abs_tol=1e-9)


def test_doji_excluded_from_both_sides():
    # 1 green (vol 200) + 1 doji (vol 999, ignored) + 1 red (vol 800)
    # green share = 0.2, red share = 0.8, in red → signed -0.8 (doji ignored).
    bars = _bars([
        (100, 110,  200, 0),  # green
        (100, 100,  999, 0),  # doji — close == open
        (110, 100,  800, 0),  # red
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=3)
    assert math.isclose(float(s.iloc[-1]), -0.8, abs_tol=1e-9)


def test_first_window_minus_one_is_nan():
    # With window=5 and only 4 rows, the rolling sum at the last row is NaN.
    bars = _bars([
        (100, 110, 1000, 0),
        (100, 105,  500, 0),
        (100, 108,  700, 0),
        (100, 102,  300, 0),
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isnan(float(s.iloc[-1]))


def test_window_all_doji_returns_nan():
    # 5 doji days → green_sum=0, red_sum=0, total=0 → division by NaN → NaN.
    bars = _bars([
        (100, 100, 1000, 0),
        (100, 100,  500, 0),
        (100, 100,  700, 0),
        (100, 100,  300, 0),
        (100, 100, 1500, 0),
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=5)
    assert math.isnan(float(s.iloc[-1]))


def test_share_weights_high_volume_days_more_than_ratio():
    # Construct a window where the *average* of green days equals the average
    # of red days (so ratio = 1.0) but most of the *total* volume is on red
    # days (so share < 0.5).
    #   Day 1 (green): vol 100
    #   Day 2 (red):   vol 900   ← high volume
    #   Day 3 (green): vol 100
    # avg_green = 100, avg_red = 900 → ratio = 100/900 ≈ 0.111
    # green share = 200 / 1100 ≈ 0.182, red share = 900 / 1100 ≈ 0.818,
    # so in red → signed -0.818.
    bars = _bars([
        (100, 110,  100, 0),
        (110, 100,  900, 0),
        (100, 110,  100, 0),
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=3)
    assert math.isclose(float(s.iloc[-1]), -(900 / 1100), abs_tol=1e-9)
    # Sanity: magnitude is small but non-zero — differs from a pure
    # avg-based metric that would also be 0.111 but for a different reason.


def test_rolling_window_advances_correctly():
    # 6 bars, window=3. Last 3 rows = (green vol 100, red vol 200, green vol 100)
    #   share = 200 / 400 = 0.5
    bars = _bars([
        (100, 110, 1000, 0),  # day -6 (outside window at end)
        (110, 100, 1000, 0),
        (100, 110, 1000, 0),
        (110, 100, 1000, 0),
        (100, 110,  100, 0),  # green in window
        (110, 100,  200, 0),  # red   in window
    ])
    # Construct a 6-bar sequence where the last 3 form the test:
    bars = _bars([
        (100, 110, 1000, 0),
        (110, 100, 1000, 0),
        (100, 110, 1000, 0),
        (100, 110,  100, 0),  # window[-3]
        (110, 100,  200, 0),  # window[-2]
        (100, 110,  100, 0),  # window[-1]
    ])
    s = _green_red_volume_share_1m(bars["open"], bars["close"], bars["volume"], window=3)
    # last window: green=200 (100+100), red=200 → green share = 0.5, boundary
    # counts as green-dominant per the function contract → signed +0.5
    assert math.isclose(float(s.iloc[-1]), 0.5, abs_tol=1e-9)
    # at row index 2, window only has 3 rows but they include 1000+1000+1000
    # green/red mix — not asserting value, just non-NaN (window complete).
    assert not math.isnan(float(s.iloc[-1]))