# `sync-news` — RSS discovery + crawler body enrichment + AI analysis

Phase 7 (hybrid ingest) + Phase 8 (OpenRouter analysis) of the
EyesInvest worker. **RSS feeds discover article URLs** (cheap, server-
rendered, work from any IP); **a web crawler then fetches each
article's full body** via trafilatura so the LLM sees real text instead
of a 300-char RSS summary. Writes pending rows for admin review.

## Why this design

Pure RSS — reliable for URL discovery but summaries are too short for
reliable AI extraction.

Pure crawler — Yahoo Finance's listing pages (and most modern news
sites') are JS-rendered SPAs. BeautifulSoup can see only the
`<header>` / `<footer>` shell; the actual article cards are injected
by client-side JavaScript. The crawler approach gets zero links.

**Hybrid wins:** RSS gives us the URL + title + author + date for free;
the crawler fetches the article page itself and extracts the full
body. ~2 HTTP requests per article but the LLM gets the full text.

The worker never publishes anything directly — every mapping / edge
lands as `status='pending'` on `ey_news_stock_mapping` /
`ey_stock_relationship`, and an admin approves them via the
`apps/admin /news` + `/relationships` queues. Approved rows become
canonical and visible to the public app (anon / authenticated reads
filtered by RLS).

## What it does

Two passes in one invocation:

| Pass | Always? | Writes | Notes |
|---|---|---|---|
| A — RSS ingest | Yes (when `NEWS_RSS_FEEDS` is set) | `ey_news_article` | Deduped by `source_url` (UNIQUE). Lookback window defaults to 48h. |
| B — OpenRouter analysis | Only when `OPENROUTER_API_KEY` is set | `ey_news_stock_mapping`, `ey_stock_relationship` (status='pending') | Bundle 5 articles per LLM call; ground symbols in the active stock universe; throttle 2s/call. |

## Configuration

All knobs live in `workers/yfinance/.env` (see `.env.example`).

### `NEWS_RSS_FEEDS`

JSON list of RSS feeds for URL discovery. Each entry:

```json
{
  "name":   "<display name, e.g. 'Reuters Business'>",
  "url":    "<RSS feed URL>",
  "market": "US | HK | GLOBAL"
}
```

Empty / unset → `sync-news` is a no-op.

### Other knobs

| Variable | Default | Purpose |
|---|---|---|
| `NEWS_CRAWL_BODY_ENABLED` | `true` | When true, fetches each article's full body via trafilatura. Set to `false` for the lighter RSS-only path (faster, but LLM gets less context). |
| `NEWS_LOOKBACK_HOURS` | `48` | Skip RSS entries older than this. |
| `NEWS_THROTTLE_SECONDS` | `1.0` | Pause between article-body fetches (be polite — datacenter IPs get rate-limited fast). |
| `NEWS_MAX_ARTICLES_PER_RUN` | `200` | Hard cap on per-run article count (caps LLM cost on first sync after a long gap). |
| `OPENROUTER_API_KEY` | (none) | Skips the AI pass when absent. |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-4-5` | Swap without code change; OpenRouter routes to any provider. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Override only if self-hosting a compatible endpoint. |
| `OPENROUTER_THROTTLE_SECONDS` | `2.0` | Pause between LLM calls. |
| `OPENROUTER_MAX_ARTICLES_PER_LLM_CALL` | `5` | Bundle size. 5 articles ≈ 2.5K input tokens → well under Haiku's 200K context. |

## CLI usage

```bash
# Full pass (RSS discover + body crawl + AI):
uv run python -m eyesinvest_worker sync-news

# Discovery + body only (no OpenRouter budget spent):
uv run python -m eyesinvest_worker sync-news --skip-llm

# Override the per-run article cap:
uv run python -m eyesinvest_worker sync-news --limit 50
```

The aggregator runs `sync-news` between `sync-shorts` and `sync-squeeze`:

```bash
pnpm worker:sync   # runs all 9 subcommands in order
```

## Cost (Claude Haiku 4.5 via OpenRouter)

Per LLM call (5 articles batched):
- Input: ~2,450 tokens (system prompt + universe + 5 articles)
- Output: ~1,300 tokens of JSON

At OpenRouter's published Haiku pricing:
- Input: $1.00 / M tokens → **~$0.0025/call**
- Output: $5.00 / M tokens → **~$0.0065/call**
- **~$0.009/copilot-call → $0.0009 per article analysed**

At 100 articles/day = 20 calls/day = **~$0.18/day, ~$5.40/month**.
At 500 articles/day = 100 calls/day = **~$0.90/day, ~$27/month**.

The `usage` field on every OpenRouter response carries
`prompt_tokens` / `completion_tokens`; the worker logs them per batch:

```
sync-news: news LLM [3/20]: in=2412 out=418
```

## How the AI is grounded

Each LLM call carries the full active stock universe inline:

```
Stock universe (use ONLY these symbols):
- AAPL (US)
- MSFT (US)
- NVDA (US)
...
- 0700.HK (HK)
- 9988.HK (HK)
...
```

The model is told to return only symbols from this list. Unknown
symbols are dropped with a warning at parse time — the LLM can't smuggle
in fake tickers.

## Worker contract (idempotency + admin safety)

The worker runs against `ey_news_article` with the following guarantees:

1. **Articles are append-and-dedup, never overwritten** — `upsert` on
   `source_url` is a no-op for rows the worker has already seen.
2. **Mappings / relationships land as `status='pending'`** — admin flips
   to `approved` / `rejected` to make them canonical.
3. **Worker never overwrites admin-resolved rows** — pre-flight SELECT
   filters out existing `approved` / `rejected` rows; only `pending`
   rows get their AI columns refreshed on a re-run.
4. **Approval columns are never touched by the worker** — `status`,
   `approved_by`, `approved_at`, `reviewer_notes` are admin-only.

## Operational notes

- **Adding a new feed** — append an entry to `NEWS_RSS_FEEDS`. Test
  first with `--skip-llm` to verify the feed is parseable.
- **Tuning the lookback** — bump `NEWS_LOOKBACK_HOURS` when a feed
  publishes bursty content you don't want dropped (e.g. weekend
  summaries). The partial index `where status = 'pending'` keeps the
  admin queue reads fast regardless of how many rows accumulate.
- **Switching LLM providers** — change `OPENROUTER_BASE_URL` (e.g. to
  a self-hosted vLLM) + `OPENROUTER_MODEL`. The OpenAI-compatible
  client handles the rest.

## Troubleshooting

### "OPENROUTER_API_KEY not set — skipping AI pass"

Expected when the worker boots before the env file is configured.
Articles still land in `ey_news_article`; mappings are empty until
the key is set.

### "no article IDs resolved — dropping AI mappings"

The orchestrator couldn't resolve `source_url` → `article_id`. Usually
transient (DB lag between Pass A's upsert and Pass B's lookup);
re-running the worker resolves it. If persistent, check that the
`ey_news_article` row actually has the URL — the upsert might have
been blocked by a malformed RSS payload.

### "All my mappings are pending"

Correct — pending rows are admin-only via RLS. The public app only
sees `status='approved'` rows. Visit `http://localhost:3001/news` to
review the queue.

### "OpenRouter returned 429"

Lower `OPENROUTER_MAX_ARTICLES_PER_LLM_CALL` to 3 and bump
`OPENROUTER_THROTTLE_SECONDS` to 5. Or switch to a model with a
higher per-minute budget (Sonnet 4.5 has separate rate limits).

### "RSS feed returns malformed XML"

Logged at WARN with `bozo_exception` detail. Worker skips the feed
and continues with the others. Fix the URL or remove it from the
allowlist.

## Related

- `docs/OPERATIONS.md` — project-wide ops runbook (cadence table).
- `apps/admin` — approval queue UI at `/news` and `/relationships`.
- Migration `local/supabase/migrations/0016_news_and_ai.sql` — schema
  definition (three tables + RLS policies).