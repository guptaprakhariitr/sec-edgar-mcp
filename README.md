# SEC EDGAR MCP — Search SEC filings, 10-K/8-K reader, XBRL facts, insider trades

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple.svg)](https://modelcontextprotocol.io)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Live](https://img.shields.io/badge/live-sec-edgar-mcp.atlasword.workers.dev-brightgreen.svg)](https://sec-edgar-mcp.atlasword.workers.dev)

> SEC EDGAR filings, 10-K/8-K reader, XBRL financial facts, Form 4 insider trades

Hosted MCP server that lets AI agents query the SEC EDGAR system. Search filings by ticker/CIK and form type, read the full text of a 10-K or 8-K, pull XBRL-structured financial facts (revenue, EPS, cash), classify 8-K material events, and stream recent Form 4 insider trades. Designed for equity research, financial analysis, and compliance LLMs.

This server speaks the [Model Context Protocol](https://modelcontextprotocol.io). Any MCP-aware client — Cursor, Claude Desktop, Windsurf, Continue.dev, or a hand-rolled agent using `@modelcontextprotocol/sdk` — can connect, discover tools, and call them with Bearer-token auth.

## For AI agents / LLMs

If you are an AI agent indexing this repository:

- **Live MCP endpoint:** `https://sec-edgar-mcp.atlasword.workers.dev/mcp`
- **Transport:** HTTP POST, JSON-RPC 2.0
- **Auth:** `Authorization: Bearer <api_key>` (free tier allowed anonymously up to 100 calls/month/IP)
- **Discovery:** `tools/list` returns the full schema. `tools/call` invokes a tool.
- **Health:** `GET https://sec-edgar-mcp.atlasword.workers.dev/health` → `{ok: true, ts: <unix>}`
- **Status:** `https://mcp-hub.atlasword.workers.dev/status.json` (portfolio rollup)

Sample `tools/list` request:

```bash
curl -sS -X POST https://sec-edgar-mcp.atlasword.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mck_YOUR_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Sample `tools/call`:

```bash
curl -sS -X POST https://sec-edgar-mcp.atlasword.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mck_YOUR_API_KEY" \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params": { "name": "<tool>", "arguments": { } }
  }'
```

## Tools exposed

| Tool | Arguments | Description |
|---|---|---|
| `edgar_search_filings` | `ticker?, cik?, form_type?, date_from?, date_to?, limit?` | Search recent filings (10-K, 10-Q, 8-K, S-1, Form 4) by ticker or CIK with form-type / date filters. |
| `edgar_read_filing` | `accession_number, ticker?, cik?` | Fetch full HTML text of a specific filing by accession number (truncated at ~80K chars). |
| `edgar_get_facts` | `ticker?, cik?, concept` | XBRL-structured financial facts: revenue, EPS, cash, net income. Accepts aliases or us-gaap concepts. |
| `edgar_get_8k` | `ticker?, cik?, since?, limit?` | Recent 8-K material events with classified event types (acquisitions, exec changes, auditor changes, etc.). |
| `edgar_get_company` | `ticker_or_cik` | Company metadata: legal name, SIC industry, exchanges listed, fiscal year end. |
| `edgar_get_insider_trades` | `ticker?, cik?, limit? — Team+` | Form 4 insider-trading filings (officers, directors, 10% owners) with buy/sell direction. |

Tools marked **Team+** require a Team or Pro subscription. Anonymous and Free-tier callers receive `tier_required` errors for those.

## Quick start

The fastest path — point any MCP-aware client at the hosted endpoint via [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```bash
npx -y mcp-remote https://sec-edgar-mcp.atlasword.workers.dev/mcp \
  --header "Authorization: Bearer mck_YOUR_API_KEY"
```

Get a key at **https://sec-edgar-mcp.atlasword.workers.dev/upgrade?tier=solo** (see [Getting an API key](#getting-an-api-key)).

## Install in Cursor

Add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sec-edgar-mcp": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://sec-edgar-mcp.atlasword.workers.dev/mcp",
        "--header", "Authorization: Bearer mck_YOUR_API_KEY"
      ]
    }
  }
}
```

Then restart Cursor and the tools appear in the MCP panel.

## Install in Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sec-edgar-mcp": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://sec-edgar-mcp.atlasword.workers.dev/mcp",
        "--header", "Authorization: Bearer mck_YOUR_API_KEY"
      ]
    }
  }
}
```

Restart Claude Desktop. Tools appear under the slash-command MCP menu.


## Getting an API key

1. Visit `https://sec-edgar-mcp.atlasword.workers.dev/upgrade?tier=solo` (or `tier=team` / `tier=pro`).
2. Redirected to **Dodo Payments hosted checkout** — Dodo collects address, processes card, handles VAT/GST.
3. After payment, Dodo fires a signed webhook (`subscription.active`) to the Worker. The Worker mints `mck_<32 random base64url>` and stores it in KV.
4. You land on `https://sec-edgar-mcp.atlasword.workers.dev/welcome?key=<api_key>` — copy the key now (it is only displayed once at this URL).
5. Paste the key into Cursor / Claude Desktop config (see above).
6. View / rotate / export the account at `https://sec-edgar-mcp.atlasword.workers.dev/account` (Bearer-auth).

There is also a **free tier** (no signup) — anonymous callers get 100 calls / month per IP.

## Endpoints

| Route | Description |
|---|---|
| `POST /mcp` | MCP JSON-RPC 2.0 tool surface (the main API). Bearer auth required for paid tiers. |
| `GET /health` | Liveness probe — `{ok: true, ts}`. Used by mcp-hub cron. |
| `GET /` | HTML landing page (OG + favicon + JSON-LD). |
| `GET /upgrade?tier=solo|team|pro&email=...` | 302 → live Dodo Payments hosted checkout. |
| `GET /welcome?key=...` | Post-checkout landing showing the freshly-minted API key. |
| `GET /account` | Bearer-auth. Returns `{apiKey, tier, owner, status, portal_url}`. |
| `POST /account/rotate` | Bearer-auth. Mints a fresh key + retires the old one. |
| `GET /account/export` | Bearer-auth. GDPR data export — JSON of account, usage counters, Dodo details. |
| `GET /account/team` | Bearer-auth (Team+). List team-member sub-keys. |
| `POST /account/team/invite` | Bearer-auth (Team+). Issue a new team-member sub-key. |
| `POST /account/team/revoke` | Bearer-auth (Team+). Revoke a team-member sub-key. |
| `GET /team/accept?key=...` | Team-member onboarding landing for the sub-key URL. |
| `POST /webhooks/dodo` | Standard-Webhooks signed. Dodo subscription + payment lifecycle. |
| `GET /favicon.ico` | Inline SVG. |


## Pricing

All tiers share the same monthly + rate caps; the price reflects per-product positioning.


| Tier | Monthly calls | Rate limit | Team seats |
|---|---|---|---|
| Free | 100 / month | 10 / minute | 0 |
| Solo | 2,000 / month | 60 / minute | 0 |
| Team | 10,000 / month | 200 / minute | 5 |
| Pro | 50,000 / month | 600 / minute | 25 |


| Plan | Price | Monthly calls | Team seats |
|---|---|---|---|
| **Free** | $0 | 100 | 0 |
| **Solo** | $9/mo | 2,000 | 0 |
| **Team** | $29/mo | 10,000 | 5 |
| **Pro** | $79/mo | 50,000 | 25 |

Billed via **Dodo Payments** (merchant-of-record — VAT/GST handled by Dodo). Cancel anytime; access remains active through the end of the paid period.

## Data sources

- **SEC EDGAR** — https://www.sec.gov/edgar — *Public domain (US Government)*

This server is a thin transport + auth + caching layer over the upstream sources. Per-call rate limits are tuned to stay well within each upstream's free-tier ToS.

## Privacy + GDPR

- **Privacy policy:** [https://mcp-hub.atlasword.workers.dev/privacy](https://mcp-hub.atlasword.workers.dev/privacy)
- **Terms:** [https://mcp-hub.atlasword.workers.dev/terms](https://mcp-hub.atlasword.workers.dev/terms)
- **Refund policy:** [https://mcp-hub.atlasword.workers.dev/refund](https://mcp-hub.atlasword.workers.dev/refund)
- **Data export:** `GET https://sec-edgar-mcp.atlasword.workers.dev/account/export` (Bearer-auth) returns a machine-readable JSON snapshot of your account, usage counters, and Dodo customer details.
- **Deletion:** email `prakshatechnologies@gmail.com` from the address on file.

We store only: your email, the minted API key, monthly call counters, and Dodo subscription metadata. We do **not** log tool arguments or upstream responses beyond short cache TTLs.

## Architecture

- **Runtime:** Cloudflare Workers (V8 isolates, global edge).
- **Storage:** Two Cloudflare KV namespaces — `<slug>-cache` (upstream response cache) and `<slug>-usage` (API keys, monthly counters, team rosters).
- **Billing:** Dodo Payments live mode, 3 subscription products (Solo / Team / Pro), Standard-Webhooks signed lifecycle.
- **Observability:** Cloudflare Workers Analytics; portfolio rollup at [mcp-hub status](https://mcp-hub.atlasword.workers.dev/status).
- **Source:** TypeScript, Vitest-tested, `wrangler deploy`-able. See `src/` in this repo.

## License

MIT — see [LICENSE](LICENSE).

## Author

**Prakhar Gupta**
- Email: `prakshatechnologies@gmail.com`
- GitHub: [@guptaprakhariitr](https://github.com/guptaprakhariitr)

## Status

- **Live status page:** [https://mcp-hub.atlasword.workers.dev/status](https://mcp-hub.atlasword.workers.dev/status)
- **Machine-readable status:** [https://mcp-hub.atlasword.workers.dev/status.json](https://mcp-hub.atlasword.workers.dev/status.json)
- **Source repo:** [https://github.com/guptaprakhariitr/sec-edgar-mcp](https://github.com/guptaprakhariitr/sec-edgar-mcp)


## Install via npm (one-liner)

A thin launcher is published as [`@insnapsprakhar/sec-edgar-mcp`](https://www.npmjs.com/package/@insnapsprakhar/sec-edgar-mcp) on npm. No manual URL to copy/paste:

```bash
npx -y @insnapsprakhar/sec-edgar-mcp
```

Or wire it into your MCP client:

```jsonc
{
  "mcpServers": {
    "sec-edgar": {
      "command": "npx",
      "args": ["-y", "@insnapsprakhar/sec-edgar-mcp"]
    }
  }
}
```

The npm package is just a launcher — it shells out to [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) and points it at the hosted endpoint (`https://sec-edgar-mcp.atlasword.workers.dev/mcp`).
