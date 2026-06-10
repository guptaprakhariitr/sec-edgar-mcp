# Changelog

All notable changes to **sec-edgar-mcp** are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.4.0] — 2026-06-10

### Changed
- **Billing migrated to Dodo Payments** (was: planned Stripe). Merchant-of-Record model — Dodo handles VAT/GST/sales-tax remittance worldwide on our behalf, lifting tax compliance off the operator.
- Env vars: `STRIPE_*` → `DODO_API_KEY` / `DODO_WEBHOOK_SECRET`. New `[vars]`: `DODO_PRODUCT_ID_{SOLO,TEAM,PRO}`, `PRODUCT_NAME`, `FROM_EMAIL`.

### Added
- `GET /upgrade?tier=…` — creates a Dodo hosted checkout link, 302s to it.
- `GET /account` — returns the caller's key + tier + Dodo customer-portal link (requires `Authorization: Bearer …`).
- `POST /webhooks/dodo` — verifies Standard-Webhooks signature (HMAC-SHA256 + 5-minute replay window), mints API keys on `subscription.active`, downgrades on cancellation/failure, idempotent on retries.
- `src/dodo.ts`, `src/webhook.ts`, `src/checkout.ts` — vendored shim, identical across all Category-1 products.
- `mintApiKey()`, `updateKeyStatus()`, `getKeyBySubscription()` in `auth.ts`.
- `KeyRecord.status` field — tracks `active` / `cancelled` / `past_due`.
- Optional Resend integration: API key emailed to the customer on subscription start.

## [0.3.1] — 2026-06-08

### Fixed
- `edgar_get_facts` returned wrong fiscal-year value when a company filed an amended 10-K (10-K/A) after the original. Now prefers the latest filing date for any (concept, fiscal_year) pair.
- 429 from `data.sec.gov` no longer cascades into a 500 — wrapper now respects `Retry-After` and surfaces a structured error to the agent.

### Changed
- Cache TTL for historical filings (filed > 90 days ago) bumped 24h → 7 days. Reduces SEC fetch volume ~40%.

## [0.3.0] — 2026-05-21

### Added
- **`edgar_get_insider_trades`** — Form 4 filings parser with direction (buy/sell), value, role of insider. Premium tool (Team tier+).
- 8-K event classification: each `edgar_get_8k` result now includes a normalized `eventType` field (e.g., `material_acquisition`, `executive_change`, `auditor_change`). Built from Item-number → label mapping; falls back to "other".

### Changed
- `edgar_get_facts` now accepts both XBRL concept names (`Revenues`) and common-name aliases (`revenue`, `total_revenue`). Alias table in `src/edgar.ts`.

## [0.2.2] — 2026-04-30

### Fixed
- Cache key for `edgar_search_filings` did not include `date_range`, so different date queries returned stale results.
- Filings with multiple amendments (e.g., 10-K/A, 10-K/A2) were deduplicated incorrectly. Now keyed on `(cik, accessionNumber)`.

## [0.2.1] — 2026-04-22

### Added
- `/health` endpoint for uptime monitoring.
- `/llms.txt` describing the MCP for AI-search engines.

### Changed
- Increased free-tier cap from 50 → 100 calls/month after seeing actual usage patterns from first 200 anonymous users.

## [0.2.0] — 2026-04-09

### Added
- **Quota enforcement** — KV-backed monthly counter + per-minute rate limit. 429 with friendly upgrade message.
- **Pricing tiers** — Free / Solo ($9) / Team ($29) / Pro ($79).
- Stripe webhook handler for subscription lifecycle (private repo).

### Changed
- Migrated from `@modelcontextprotocol/sdk` Node transport to custom HTTP shim (smaller bundle, ~12KB vs ~140KB).

## [0.1.0] — 2026-03-15

### Added
- Initial release. Four tools:
  - `edgar_search_filings`
  - `edgar_read_filing`
  - `edgar_get_facts`
  - `edgar_get_company`
- 8-K listing (no event classification) via `edgar_get_8k`.
- KV cache with 1h–24h TTLs.
- Deployed to `https://sec-edgar-mcp.workers.dev/mcp`.
- Listed on Smithery, Glama, mcp.so.
