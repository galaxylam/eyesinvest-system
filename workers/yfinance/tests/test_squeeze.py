"""Pure-Python tests for the squeeze-scoring helpers — no HTTP, no Supabase.

Covers the four boundary cases that guard the worker's per-stock scoring:
1. DTC normal + DTC degenerate (zero volume / None inputs).
2. SI Δ 1W using FINRA `change_pct`, then falling back to
   `prior_short_interest`, then deriving from two SI rows.
3. AM ratio missing one side → null.
4. Composite score: max components → 100, US (no AM) → 90, all-null → null.
"""

from __future__ import annotations

import math

from eyesinvest_worker.providers.analytics import (
    ShortInterestInput,
    _am_ratio,
    _clip01,
    _days_to_cover,
    _si_change_pct_1w,
    _squeeze_score,
)


def test_days_to_cover_normal():
    # 1M shares / 200K daily = 5.0 days
    assert _days_to_cover(1_000_000, 200_000) == 5.0


def test_days_to_cover_zero_volume_returns_none():
    assert _days_to_cover(1_000_000, 0) is None


def test_days_to_cover_none_inputs():
    assert _days_to_cover(None, 100_000) is None
    assert _days_to_cover(1_000_000, None) is None


def test_si_change_pct_1w_single_row_with_change_pct_returns_it():
    # A single FINRA row IS valid — FINRA populates `change_pct` against
    # its own prior settlement, so we trust it even with only 1 row.
    rows = [ShortInterestInput(short_interest=110, change_pct=10.0)]
    assert _si_change_pct_1w(rows) == 10.0


def test_si_change_pct_1w_single_row_no_change_pct_returns_none():
    # Single CDN-only row with no `prior_short_interest` → can't derive.
    rows = [ShortInterestInput(short_interest=110)]
    assert _si_change_pct_1w(rows) is None


def test_si_change_pct_1w_uses_change_pct():
    # Worker path 1: FINRA API populated `change_pct`.
    rows = [
        ShortInterestInput(short_interest=110, change_pct=10.0),
        ShortInterestInput(short_interest=100),
    ]
    assert _si_change_pct_1w(rows) == 10.0


def test_si_change_pct_1w_falls_back_to_prior_short_interest():
    # Worker path 2: CDN-only row → `change_pct` is null but
    # `prior_short_interest` is set. Compute (110-100)/100*100.
    rows = [
        ShortInterestInput(short_interest=110, prior_short_interest=100),
        ShortInterestInput(short_interest=100),
    ]
    assert _si_change_pct_1w(rows) == 10.0


def test_si_change_pct_1w_derives_from_two_rows():
    # Worker path 3: Both `change_pct` and `prior_short_interest` null on
    # the latest row, but the worker pulled 2 rows — derive from rows[1].
    rows = [
        ShortInterestInput(short_interest=120),
        ShortInterestInput(short_interest=100),
    ]
    assert _si_change_pct_1w(rows) == 20.0


def test_si_change_pct_1w_no_prior_returns_none():
    # Worker path 4: single-row universe → can't derive anything.
    rows = [ShortInterestInput(short_interest=110)]
    assert _si_change_pct_1w(rows) is None


def test_am_ratio_normal():
    assert _am_ratio(50_000, 100_000) == 50.0


def test_am_ratio_missing_am_returns_none():
    assert _am_ratio(None, 100_000) is None


def test_am_ratio_zero_full_returns_none():
    assert _am_ratio(50_000, 0) is None


def test_clip01_clamps_below_lo():
    assert _clip01(-50.0, 0, 10) == 0.0


def test_clip01_clamps_above_hi():
    assert _clip01(99.0, 0, 10) == 1.0


def test_clip01_none_returns_zero():
    assert _clip01(None, 0, 10) == 0.0


def test_clip01_negative_range():
    # SI Δ range is -30..+30. 0 should normalise to 0.5.
    assert _clip01(0.0, -30, 30) == 0.5


def test_squeeze_score_all_null_returns_none():
    # All inputs null → all parts = 0 → composite is None (not 0).
    assert _squeeze_score(None, None, None, None, None) is None


def test_squeeze_score_max_components_yields_100():
    # DTC=10 (top of 0..10), SI=+30, dd=-30%, vol=5×, AM=80% — all 1.0
    # contributions → 100.
    score = _squeeze_score(10, 30, -0.30, 5, 80)
    assert score is not None
    assert math.isclose(score, 100.0, abs_tol=0.01)


def test_squeeze_score_us_no_am_caps_at_90():
    # US row: am_ratio=None. Max US score = 0.90 × 100 = 90 (the 0.10
    # AM weight is lost — acceptable per docs/SQUEEZE.md).
    score = _squeeze_score(10, 30, -0.30, 5, None)
    assert score is not None
    assert math.isclose(score, 90.0, abs_tol=0.01)


def test_squeeze_score_zero_dtc_drops_one_weight():
    # DTC=0 → its 0.30 weight contributes 0. Remaining max = 70.
    score = _squeeze_score(0, 30, -0.30, 5, 80)
    assert score is not None
    assert math.isclose(score, 70.0, abs_tol=0.01)


def test_squeeze_score_midrange_components():
    # DTC=5 (0.5), SI=0 (0.5), dd=-15% (0.5), vol=3× (0.5), AM=60% (0.5)
    # → 0.5 × (0.30+0.25+0.20+0.15+0.10) × 100 = 0.5 × 1.0 × 100 = 50.
    score = _squeeze_score(5, 0, -0.15, 3.0, 60)
    assert score is not None
    assert math.isclose(score, 50.0, abs_tol=0.01)


def test_squeeze_score_negative_si_dampens_score():
    # SI=-30 (shorts covering) → SI component = 0. DTC=10 (1.0), dd=-0.30
    # (1.0), vol=5 (1.0), AM=80 (1.0) → all 1.0. Total = (0.30 + 0.20 +
    # 0.15 + 0.10) × 100 = 75.
    score = _squeeze_score(10, -30, -0.30, 5, 80)
    assert score is not None
    assert math.isclose(score, 75.0, abs_tol=0.01)


def test_squeeze_score_clamps_above_range():
    # Inputs above the normalisation range clamp — DTC=99 still counts as
    # full DTC credit.
    score = _squeeze_score(99, 99, -0.99, 9, 99)
    assert score is not None
    assert math.isclose(score, 100.0, abs_tol=0.01)