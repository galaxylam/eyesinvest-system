"""Authenticated FINRA Developer API — official source for short-sale data.

Two datasets:
  - ``regShoDaily``          → daily FINRA short-sale volume (consolidated across
                              reporting facilities — multiple rows per ticker/date
                              must be summed to get the official daily number).
  - ``consolidatedShortInterest`` → bi-weekly outstanding short positions
                              (includes prior, change %, days-to-cover).

Auth flow: OAuth2 client-credentials grant, then Bearer token cached for
the duration of the worker run.

The CDN scraper in ``shorts.py`` remains as a fallback for environments
where the user hasn't provisioned FINRA Developer credentials.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any

from eyesinvest_worker.log import logger
from eyesinvest_worker.models import ShortInterestRow, ShortSaleRow

# OAuth2 + dataset URLs (from the FINRA guide).
_TOKEN_URL = (
    "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials"
)
_API_BASE = "https://api.finra.org/data/group/otcMarket/name"
_TIMEOUT_SECONDS = 60
_REQUEST_THROTTLE_SECONDS = 0.5  # stay well under the 1,200 req/min/IP cap


class FinraApiError(RuntimeError):
    """Raised when the FINRA API returns a non-2xx response or auth fails."""


class FinraClient:
    """Per-run OAuth2 + dataset client.

    Holds a cached Bearer token; re-requests it on 401. Designed for the
    worker's short-running CLI invocations — the token lifetime (~12h) far
    exceeds a single `sync-shorts` run.
    """

    def __init__(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self._token_acquired_at: float = 0.0

    # ----- Auth ---------------------------------------------------------------

    def _fetch_token(self) -> str:
        """Exchange client_id:client_secret for a Bearer token via Basic auth."""
        import base64  # local import keeps the import surface tight

        creds = f"{self._client_id}:{self._client_secret}".encode()
        req = urllib.request.Request(
            _TOKEN_URL,
            headers={
                "Authorization": "Basic " + base64.b64encode(creds).decode(),
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
                body = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            raise FinraApiError(
                f"FINRA token endpoint: HTTP {exc.code}: {exc.read().decode()[:200]}"
            ) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise FinraApiError(f"FINRA token endpoint unreachable: {exc}") from exc

        token = body.get("access_token")
        if not token:
            raise FinraApiError(f"FINRA token response missing access_token: {body!r}")
        return token

    def _get_token(self) -> str:
        # Re-fetch if we never acquired one, or if it's >11h old (token TTL
        # is ~12h per the guide; we re-fetch slightly early).
        if (
            self._token is None
            or (time.monotonic() - self._token_acquired_at) > 11 * 3600
        ):
            self._token = self._fetch_token()
            self._token_acquired_at = time.monotonic()
            logger.info("FINRA OAuth2 token acquired (cache 11h)")
        return self._token

    # ----- HTTP ---------------------------------------------------------------

    def _post(self, dataset: str, payload: dict[str, Any]) -> Any:
        """POST against `/data/group/otcMarket/name/{dataset}`. Auto-retries on 401.

        FINRA occasionally returns a 2xx with an empty or non-JSON body
        (transient upstream hiccup). We treat that as a retryable error —
        one backoff + retry, then raise ``FinraApiError`` so the per-ticker
        caller can skip just the failing symbol instead of taking down the
        whole ``sync-shorts`` run.
        """
        body = json.dumps(payload).encode("utf-8")
        url = f"{_API_BASE}/{dataset}"
        last_err: Exception | None = None
        for attempt in (1, 2):
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "Authorization": f"Bearer {self._get_token()}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
                    raw = resp.read()
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:200]
                if exc.code == 401 and attempt == 1:
                    logger.info("FINRA 401 — refreshing OAuth token and retrying")
                    self._token = None
                    continue
                raise FinraApiError(
                    f"FINRA POST {dataset}: HTTP {exc.code}: {detail}"
                ) from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_err = exc
                logger.warning(f"FINRA POST {dataset}: {exc}")
                break

            # 2xx — parse the body. Empty / non-JSON responses are treated as
            # transient: retry once before giving up.
            if not raw:
                logger.warning(
                    f"FINRA POST {dataset}: empty body (attempt {attempt}/2)"
                )
                if attempt == 1:
                    time.sleep(_REQUEST_THROTTLE_SECONDS)
                    continue
                raise FinraApiError(
                    f"FINRA POST {dataset}: empty body after retry"
                )
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                snippet = raw[:200].decode(errors="replace")
                logger.warning(
                    f"FINRA POST {dataset}: non-JSON body (attempt {attempt}/2): "
                    f"{snippet!r}"
                )
                if attempt == 1:
                    time.sleep(_REQUEST_THROTTLE_SECONDS)
                    continue
                raise FinraApiError(
                    f"FINRA POST {dataset}: non-JSON body after retry: {snippet!r}"
                ) from exc

        raise FinraApiError(f"FINRA POST {dataset}: network error: {last_err}")


# ---------------------------------------------------------------------------
# Daily short volume (regShoDaily)
# ---------------------------------------------------------------------------


def _aggregate_daily_by_date(rows: list[dict]) -> dict[str, dict[str, int]]:
    """Sum reporting-facility rows into one row per (ticker, date).

    FINRA may emit multiple rows per ticker/date — split by
    ``reportingFacilityCode`` (NQTRF, NYTRF, ADF, …). Per the API guide:

        Daily Short Volume    = SUM(shortParQuantity)
        Daily FINRA Volume    = SUM(totalParQuantity)
        Regular Short Volume  = shortParQuantity - shortExemptParQuantity
                                 (we keep exempt separate but don't double-count)

    We aggregate by ticker → date, NOT by ticker globally, because the
    filter query can return many dates for one ticker.
    """
    daily: dict[tuple[str, str], dict[str, int]] = {}
    for row in rows:
        d = row.get("tradeReportDate")
        sym = row.get("securitiesInformationProcessorSymbolIdentifier")
        if not d or not sym:
            continue
        key = (sym, d)
        slot = daily.setdefault(
            key,
            {
                "short_volume": 0,
                "short_exempt_volume": 0,
                "total_volume": 0,
            },
        )
        # `shortParQuantity` already INCLUDES short-exempt volume per the
        # FINRA guide. Sum it directly into `short_volume`; track exempt
        # separately so the UI can subtract if it wants "regular short only".
        slot["short_volume"] += int(row.get("shortParQuantity") or 0)
        slot["short_exempt_volume"] += int(row.get("shortExemptParQuantity") or 0)
        slot["total_volume"] += int(row.get("totalParQuantity") or 0)
    return {f"{k[0]}|{k[1]}": v for k, v in daily.items()}


def fetch_reg_sho_daily(
    client: FinraClient,
    symbol_map: dict[str, str],
    start_date: date,
    end_date: date,
) -> list[ShortSaleRow]:
    """Fetch + aggregate daily short volume for every ticker in ``symbol_map``.

    One POST per ticker — keeps the response small and well under the 5000-row
    sync limit. Each ticker query spans [start_date, end_date] inclusive.
    """
    rows: list[ShortSaleRow] = []
    start = start_date.isoformat()
    end = end_date.isoformat()

    for i, (symbol, stock_id) in enumerate(symbol_map.items(), start=1):
        try:
            payload = {
                "fields": [
                    "tradeReportDate",
                    "securitiesInformationProcessorSymbolIdentifier",
                    "shortParQuantity",
                    "shortExemptParQuantity",
                    "totalParQuantity",
                    "marketCode",
                    "reportingFacilityCode",
                ],
                "compareFilters": [
                    {
                        "compareType": "equal",
                        "fieldName": "securitiesInformationProcessorSymbolIdentifier",
                        "fieldValue": symbol.upper(),
                    }
                ],
                "dateRangeFilters": [
                    {
                        "fieldName": "tradeReportDate",
                        "startDate": start,
                        "endDate": end,
                    }
                ],
                "limit": 5000,
            }
            resp = client._post("regShoDaily", payload)
        except FinraApiError as exc:
            logger.warning(f"regShoDaily[{symbol}]: {exc}")
            continue

        aggregated = _aggregate_daily_by_date(resp or [])
        # `aggregated` keys are `<symbol>|<date>` — filter to our ticker (defence
        # against FINRA returning rows for other symbols that match a wildcard).
        for key, vals in aggregated.items():
            ticker, d_str = key.split("|", 1)
            if ticker != symbol.upper():
                continue
            try:
                d = date.fromisoformat(d_str)
            except ValueError:
                continue
            rows.append(
                ShortSaleRow(
                    stock_id=stock_id,
                    trade_date=d,
                    short_volume=vals["short_volume"],
                    short_exempt_volume=vals["short_exempt_volume"],
                    total_volume=vals["total_volume"],
                )
            )

        if i < len(symbol_map):
            time.sleep(_REQUEST_THROTTLE_SECONDS)

    logger.info(f"regShoDaily: {len(rows)} aggregated daily rows")
    return rows


# ---------------------------------------------------------------------------
# Consolidated short interest (consolidatedShortInterest)
# ---------------------------------------------------------------------------


def fetch_consolidated_short_interest(
    client: FinraClient,
    symbol_map: dict[str, str],
) -> list[ShortInterestRow]:
    """Fetch the latest short-interest report per ticker in ``symbol_map``.

    The default sort is FINRA's own (most recent settlement first). We pull
    up to 5000 rows per ticker so the user gets full history if they ever
    backfill — the on-disk upsert is idempotent on (stock_id, settlement_date).
    """
    rows: list[ShortInterestRow] = []
    for i, (symbol, stock_id) in enumerate(symbol_map.items(), start=1):
        try:
            payload = {
                "fields": [
                    "symbolCode",
                    "settlementDate",
                    "currentShortPositionQuantity",
                    "previousShortPositionQuantity",
                    "changePreviousNumber",
                    "changePercent",
                    "averageDailyVolumeQuantity",
                    "daysToCoverQuantity",
                    "stockSplitFlag",
                    "revisionFlag",
                ],
                "compareFilters": [
                    {
                        "compareType": "equal",
                        "fieldName": "symbolCode",
                        "fieldValue": symbol.upper(),
                    }
                ],
                "limit": 5000,
            }
            resp = client._post("consolidatedShortInterest", payload)
        except FinraApiError as exc:
            logger.warning(f"consolidatedShortInterest[{symbol}]: {exc}")
            continue

        for r in resp or []:
            d_str = r.get("settlementDate")
            cur = r.get("currentShortPositionQuantity")
            if not d_str or cur is None:
                continue
            try:
                d = date.fromisoformat(d_str)
            except ValueError:
                continue
            rows.append(
                ShortInterestRow(
                    stock_id=stock_id,
                    settlement_date=d,
                    short_interest=int(cur),
                    days_to_cover=_as_float(r.get("daysToCoverQuantity")),
                    prior_short_interest=_as_int(r.get("previousShortPositionQuantity")),
                    change_pct=_as_float(r.get("changePercent")),
                )
            )

        if i < len(symbol_map):
            time.sleep(_REQUEST_THROTTLE_SECONDS)

    logger.info(f"consolidatedShortInterest: {len(rows)} settlement rows")
    return rows


# ---------------------------------------------------------------------------
# Convenience wrappers used by cli.py — same shape as the CDN-based helpers.
# ---------------------------------------------------------------------------


def sync_short_sales_via_api(
    client: FinraClient,
    symbol_map: dict[str, str],
    days: int = 7,
) -> list[ShortSaleRow]:
    """Pull last ``days`` of `regShoDaily` for every ticker."""
    end = date.today()
    start = end - timedelta(days=days)
    return fetch_reg_sho_daily(client, symbol_map, start, end)


def sync_short_interest_via_api(
    client: FinraClient,
    symbol_map: dict[str, str],
) -> list[ShortInterestRow]:
    """Pull all available `consolidatedShortInterest` rows for every ticker."""
    return fetch_consolidated_short_interest(client, symbol_map)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _as_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None