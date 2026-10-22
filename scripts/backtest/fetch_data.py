"""Pull the raw inputs the screener backtest needs out of Supabase.

Tables pulled (all via PostgREST, read-only):
  ey_stocks          — universe (symbol, market, sector, is_active)
  ey_price_1d        — daily OHLCV (the backbone of every technical filter)
  ey_short_interest  — bi-weekly positions outstanding (squeeze components)
  ey_short_sale_1d  — daily short-sale volume + HK AM session (squeeze AM ratio)

Output: gzip CSVs under scripts/backtest/data/. Re-runs are incremental —
if a cached file exists it is reused unless --refresh is passed.

Usage:
    workers/yfinance/.venv/bin/python scripts/backtest/fetch_data.py
    workers/yfinance/.venv/bin/python scripts/backtest/fetch_data.py --refresh
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "apps" / "web" / ".env.local"
DATA_DIR = Path(__file__).resolve().parent / "data"

PAGE_SIZE = 5000


def load_env() -> dict[str, str]:
    """Parse KEY=VALUE lines out of apps/web/.env.local (no dotenv dep)."""
    env: dict[str, str] = {}
    if not ENV_FILE.exists():
        raise SystemExit(f"missing {ENV_FILE}")
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def _request(url: str, key: str, rng: str | None = None, retries: int = 4) -> tuple[bytes, str | None]:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept-Encoding": "gzip",
    }
    if rng:
        headers["Range"] = rng
    last_err: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body, resp.headers.get("Content-Range")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last_err = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"request failed after {retries} attempts: {url} ({last_err})")


def fetch_table(url: str, key: str, table: str, columns: str, order: str | None = None) -> list[dict]:
    """Paginate a PostgREST table with Range headers until exhausted."""
    rows: list[dict] = []
    offset = 0
    while True:
        q = f"{url}/rest/v1/{table}?select={columns}"
        if order:
            q += f"&order={order}"
        body, content_range = _request(q, key, rng=f"{offset}-{offset + PAGE_SIZE - 1}")
        page = json.loads(body)
        rows.extend(page)
        offset += len(page)
        total = None
        if content_range and "/" in content_range:
            tail = content_range.split("/")[-1].strip()
            if tail.isdigit():
                total = int(tail)
        if len(page) < PAGE_SIZE:
            break
        if total is not None and offset >= total:
            break
        sys.stderr.write(f"  {table}: {offset}/{total if total is not None else '?'} rows\r")
        sys.stderr.flush()
    sys.stderr.write(f"  {table}: {len(rows)} rows\n")
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    import csv

    if not rows:
        path.write_text("")
        return
    fields = list(rows[0].keys())
    with gzip.open(path, "wt", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download even if cached")
    args = parser.parse_args()

    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    specs = [
        ("ey_stocks", "id,symbol,name,market,sector,currency,is_active", "symbol"),
        ("ey_price_1d", "stock_id,trade_date,open,high,low,close,volume", "stock_id,trade_date"),
        ("ey_short_interest", "stock_id,settlement_date,market,short_interest,prior_short_interest,change_pct", "stock_id,settlement_date"),
        ("ey_short_sale_1d", "stock_id,trade_date,market,short_volume,am_short_volume,total_volume", "stock_id,trade_date"),
    ]

    for table, columns, order in specs:
        out = DATA_DIR / f"{table}.csv.gz"
        if out.exists() and not args.refresh:
            print(f"{table}: cached ({out.stat().st_size / 1024:.0f} KB)")
            continue
        print(f"{table}: downloading...")
        rows = fetch_table(url, key, table, columns, order)
        write_csv(out, rows)
        print(f"{table}: wrote {len(rows)} rows -> {out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
