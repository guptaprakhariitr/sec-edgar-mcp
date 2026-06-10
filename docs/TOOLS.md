# Tools Reference

This is the authoritative per-tool reference for **sec-edgar-mcp**. It's also what AI agents read when deciding whether to call your tools — descriptions are written for an LLM caller, not for a human user.

---

## `edgar_search_filings`

Search SEC EDGAR filings for a US-listed company by ticker or CIK, optionally filtered by form type and date range.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `ticker` | string | one-of | Stock ticker (e.g. `"MSFT"`). Provide ticker OR cik. |
| `cik` | string | one-of | 10-digit zero-padded CIK (e.g. `"0000789019"`). |
| `form_type` | string | no | Form type prefix-match: `"10-K"` matches `10-K` and `10-K/A`. Common values: `10-K`, `10-Q`, `8-K`, `S-1`, `4`, `13D`, `13G`. |
| `date_from` | string | no | ISO `YYYY-MM-DD`. |
| `date_to` | string | no | ISO `YYYY-MM-DD`. |
| `limit` | integer | no | Default 25, max 200. |

**Output**

```json
{
  "count": 1,
  "filings": [
    {
      "accessionNumber": "0001564590-24-029333",
      "filingDate": "2024-07-30",
      "reportDate": "2024-06-30",
      "formType": "10-K",
      "primaryDocument": "msft-20240630.htm",
      "primaryDocumentUrl": "https://www.sec.gov/Archives/edgar/data/789019/000156459024029333/msft-20240630.htm",
      "filerCik": "0000789019",
      "filerName": "MICROSOFT CORP",
      "isAmendment": false
    }
  ]
}
```

**Example call**

```json
{
  "name": "edgar_search_filings",
  "arguments": { "ticker": "MSFT", "form_type": "10-K", "date_from": "2023-01-01" }
}
```

---

## `edgar_read_filing`

Fetch the full text of a filing by accession number. Returns HTML (most filings) or text. Truncates at ~80K characters; pair with `edgar_search_filings` to find the right accession first.

**Input**

| Field | Type | Required | Description |
|---|---|---|---|
| `accession_number` | string | yes | E.g. `"0001564590-24-029333"`. |
| `ticker` or `cik` | string | yes | Needed to construct the document URL. |

**Output**

```json
{
  "accessionNumber": "0001564590-24-029333",
  "formType": "10-K",
  "text": "<html>...truncated at 80,000 chars...</html>",
  "truncated": true,
  "sourceUrl": "https://www.sec.gov/Archives/edgar/data/789019/000156459024029333/msft-20240630.htm"
}
```

---

## `edgar_get_facts`

Get XBRL-structured financial facts for a company across all reported fiscal periods. Accepts common-name aliases:

| Alias | XBRL concept |
|---|---|
| `revenue`, `total_revenue`, `net_revenue` | `Revenues` |
| `operating_income` | `OperatingIncomeLoss` |
| `net_income` | `NetIncomeLoss` |
| `cash` | `CashAndCashEquivalentsAtCarryingValue` |
| `total_assets` | `Assets` |
| `total_liabilities` | `Liabilities` |
| `eps` | `EarningsPerShareDiluted` |
| `eps_basic` | `EarningsPerShareBasic` |

Or pass any `us-gaap` concept directly.

**Behavior**

- Returns one row per `(fiscal_year, fiscal_period)`. If an amendment (`10-K/A`) restates a value, the amendment takes precedence (latest `filed` date wins).
- Sorted newest-first.

**Example output**

```json
{
  "count": 3,
  "facts": [
    { "concept": "Revenues", "unit": "USD", "value": 245122000000, "fiscalYear": 2024, "fiscalPeriod": "FY", "filed": "2024-09-12", "formType": "10-K/A", "accessionNumber": "0001564590-24-029997" },
    { "concept": "Revenues", "unit": "USD", "value": 211915000000, "fiscalYear": 2023, "fiscalPeriod": "FY", "filed": "2023-07-27", "formType": "10-K",   "accessionNumber": "0001564590-23-009647" },
    { "concept": "Revenues", "unit": "USD", "value": 198270000000, "fiscalYear": 2022, "fiscalPeriod": "FY", "filed": "2022-07-28", "formType": "10-K",   "accessionNumber": "0001564590-22-026876" }
  ]
}
```

---

## `edgar_get_8k`

Recent 8-K (material event) filings with classified `eventType`. Use this to answer "has anything material happened with X recently?"

**Event types (subset)**

| eventType | 8-K item | Meaning |
|---|---|---|
| `material_definitive_agreement` | 1.01 | Entered into a new material contract |
| `completion_of_acquisition` | 2.01 | Completed an acquisition |
| `results_of_operations` | 2.02 | Quarterly results announced |
| `material_impairment` | 2.06 | Recorded an impairment charge |
| `auditor_change` | 4.01 | Changed auditor |
| `non_reliance_on_prior_filings` | 4.02 | Prior financials should not be relied upon |
| `change_in_control` | 5.01 | Change in control |
| `executive_change` | 5.02 | Officer / director appointed or departed |
| `regulation_fd_disclosure` | 7.01 | Reg FD disclosure |
| `other_events` | 8.01 | Other |

Multi-item 8-Ks return all items in `itemNumbers`; `eventType` is the first.

---

## `edgar_get_company`

Look up a company by ticker or CIK.

```json
{
  "cik": "0000789019",
  "ticker": "MSFT",
  "name": "MICROSOFT CORP",
  "sic": "7372",
  "sicDescription": "Services-Prepackaged Software",
  "exchanges": ["Nasdaq"],
  "fiscalYearEnd": "0630"
}
```

---

## `edgar_get_insider_trades` *(premium — Team tier and up)*

Recent Form 4 insider trades. Returns insider name, role, direction (buy/sell), and accession number for follow-up.

```json
{
  "count": 5,
  "trades": [
    { "filingDate": "2024-07-24", "insider": "SATYA NADELLA", "role": "CEO", "direction": "sell", "accessionNumber": "0001127602-24-019441" }
  ]
}
```

---

## Client setup

### Cursor

In `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sec-edgar": {
      "url": "https://sec-edgar-mcp.workers.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

### Claude Desktop

Same; under `mcpServers`. Restart Claude after editing the config.

### Cline / Continue

Use the URL-mode connector with the same hosted endpoint.

### Anonymous (free tier)

Omit the `Authorization` header. You get **100 calls/month** with a 10/min ceiling. Same endpoint URL.

---

## Errors

| Code | Meaning | Action |
|---|---|---|
| `-32601` Method not found | Wrong MCP method name | Verify your client is on protocol `2025-06-18` or compatible. |
| `-32000` Premium-only | You called a premium tool on free tier | Upgrade at `/upgrade`. |
| HTTP 429 | Quota exceeded | Check the `Retry-After` header; consider upgrading. |
| HTTP 502 with "SEC rate limit (429)" | SEC's upstream rate limit | Retry after the duration specified; usually 10s. |

---

## Source data

All data is sourced live from the [SEC EDGAR public APIs](https://www.sec.gov/os/accessing-edgar-data) at `data.sec.gov` and `www.sec.gov`. SEC data is in the public domain. We respect the SEC's fair-use policy by:

- Sending a polite `User-Agent` per their guidance.
- Caching responses for 1–24h to reduce traffic to SEC.
- Surfacing 429s with `Retry-After` rather than masking them.

Data freshness: company submissions and XBRL endpoints are updated by SEC within minutes of filing. Our cache may add up to 1 hour of staleness on the freshest filings.
