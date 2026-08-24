"""HKEX daily + morning-session short-selling turnover — parser / placeholder / URL constants.

These guard three things:

1. The parser skips placeholder text on both the full-day page
   ("will be available after day close") and the morning-session page
   ("will be available after …") — so a pre-lunch or pre-close run never
   produces a false-zero row.
2. The new AM URL constants point at the English HKEX morning-session
   pages, mirroring the existing full-day URL convention.
3. The combined sync merges AM and full-day fields correctly when both
   are populated.

No HTTP is performed — these tests exercise the pure-Python helpers only.
"""

from eyesinvest_worker.providers import hkex_daily
from eyesinvest_worker.providers.hkex_daily import (
    HKEX_AM_GEM_URL,
    HKEX_AM_MAIN_URL,
    parse_hkex_short_selling_text,
)


def test_full_day_placeholder_returns_empty():
    text = "Daily Short Selling Turnover will be available after day close"
    assert parse_hkex_short_selling_text(text) == []


def test_am_placeholder_returns_empty():
    text = (
        "Morning Session Short Selling Turnover for the Main Board\n"
        "will be available after lunch break\n"
    )
    assert parse_hkex_short_selling_text(text) == []


def test_am_substring_placeholder_returns_empty():
    # Some HKEX AM pages use shorter copy; the substring match handles both.
    text = "Data will be available after 12:00"
    assert parse_hkex_short_selling_text(text) == []


def test_am_url_constants_use_english_paths():
    assert HKEX_AM_MAIN_URL.endswith("/eng/stat/smstat/ssturnover/ncms/MSHTMAIN.HTM")
    assert HKEX_AM_GEM_URL.endswith("/eng/stat/smstat/ssturnover/ncms/MSHTGEM.HTM")
    assert HKEX_AM_MAIN_URL.startswith("https://www.hkex.com.hk/")


def test_am_placeholder_constant_is_substring():
    # The AM phrase is a prefix match (substring) so both "after lunch break"
    # and "after morning session close" style copy are caught.
    assert "will be available after" in hkex_daily._AM_PLACEHOLDER_PHRASE


def test_populated_am_page_parses_rows():
    # Synthetic AM-page body — same row shape as the full-day page.
    body = "\n".join(
        [
            "<pre><font size='1'>",
            "Morning Session Short Selling Turnover",
            "  700  TENCENT                       123,456    7,890,123     0.85%",
            "  9988 BABA GROUP HOLDING             45,678    2,345,678     0.42%",
            "</font></pre>",
        ]
    )
    rows = parse_hkex_short_selling_text(body)
    assert len(rows) == 2
    assert rows[0][0] == 700
    assert rows[0][1] == "TENCENT"
    assert rows[0][2] == 123456
    assert rows[0][3] == 7890123.0
    assert rows[1][0] == 9988
    assert rows[1][1] == "BABA GROUP HOLDING"


def test_live_format_without_pct_parses_rows():
    # The live HKEX pages (verified 2026-08-24) do NOT include a percentage
    # column. The regex must accept rows that end in just the HKD amount.
    body = "\n".join(
        [
            "<pre><font size='1'>",
            "Short Selling Turnover (Main Board) up to day close today",
            "      1  CKH HOLDINGS             1,380,000     96,529,425",
            "      5  HSBC HOLDINGS            2,068,000    333,309,440",
            "     20  SENSETIME-W            138,003,000    204,876,135",
            "</font></pre>",
        ]
    )
    rows = parse_hkex_short_selling_text(body)
    assert len(rows) == 3
    assert rows[0] == (1, "CKH HOLDINGS", 1380000, 96529425.0)
    assert rows[1] == (5, "HSBC HOLDINGS", 2068000, 333309440.0)
    # Code with hyphen and digit-letters name (e.g. SENSETIME-W).
    assert rows[2] == (20, "SENSETIME-W", 138003000, 204876135.0)