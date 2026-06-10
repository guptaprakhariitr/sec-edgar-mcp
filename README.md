# sec-edgar-mcp

> Hosted MCP server that gives AI agents real-time access to SEC EDGAR — filings search, 10-K/8-K reading, XBRL financial facts, and insider-trade (Form 4) alerts. **Free underlying data, no API key required by SEC, indie-priced from $9/mo.**

![demo](./docs/demo.gif)

```
Claude: "What were Microsoft's revenue and operating income for FY2024?"
Tool: edgar_get_facts(ticker="MSFT", concept="Revenues")
       edgar_get_facts(ticker="MSFT", concept="OperatingIncomeLoss")
Claude: "Microsoft's FY2024 revenue was $245.1B (+15.7% YoY) and operating income was $109.4B…"
```

---

## What it does

Six tools, all backed by the SEC's free EDGAR APIs (no key required, only a polite `User-Agent` per SEC fair-use policy).

| Tool | What it returns |
|---|---|
| `edgar_search_filings` | Search filings by ticker / CIK / form type / date range. |
| `edgar_read_filing` | Full text (or summary) of a specific filing by accession number. |
| `edgar_get_facts` | XBRL-structured financial facts (Revenue, OperatingIncome, Cash, etc.). |
| `edgar_get_8k` | Recent 8-K material event filings for a ticker, classified by event type. |
| `edgar_get_company` | Company metadata (CIK, SIC, exchange, executives). |
| `edgar_get_insider_trades` | Form 4 filings (insider buys/sells) with directionality. |

Full per-tool reference: [`docs/TOOLS.md`](docs/TOOLS.md).

---

## Install

### In Cursor

```bash
# in your Cursor settings, MCP servers tab, add:
{
  "sec-edgar": {
    "url": "https://sec-edgar-mcp.workers.dev/mcp",
    "headers": { "Authorization": "Bearer YOUR_API_KEY" }
  }
}
```

Or one-click via Smithery: `https://smithery.ai/server/sec-edgar-mcp/install/cursor`.

### In Claude Desktop

```json
{
  "mcpServers": {
    "sec-edgar": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch", "https://sec-edgar-mcp.workers.dev/mcp"],
      "env": { "MCP_AUTH_TOKEN": "YOUR_API_KEY" }
    }
  }
}
```

### In Cline / Continue

Same URL pattern as Cursor. See [`docs/TOOLS.md`](docs/TOOLS.md#client-setup).

### Free tier (no API key)

Send requests without an `Authorization` header. You get **100 calls / month** with a 10-req/min ceiling. Hot enough to try, not enough for production.

---

## Pricing

| Tier | Price | Monthly calls | Rate limit | Premium tools |
|---|---|---|---|---|
| Free | $0 | 100 | 10/min | — |
| Solo | **$9 / mo** | 2,000 | 60/min | — |
| Team | **$29 / mo** | 10,000 | 200/min | XBRL bulk facts, 8-K subscribe |
| Pro | **$79 / mo** | 50,000 | 600/min | All of the above + email/webhook alerts |

Subscribe at [sec-edgar-mcp.workers.dev/upgrade](https://sec-edgar-mcp.workers.dev/upgrade) (or once Smithery's bundled billing is wired, via Smithery checkout — see [DISTRIBUTION.md](docs/DISTRIBUTION.md)).

---

## How it works

```
┌────────────┐      ┌────────────────────────┐      ┌──────────────────┐
│ Cursor /   │      │ Cloudflare Worker      │      │ data.sec.gov     │
│ Claude /   │ ───► │ sec-edgar-mcp          │ ───► │ www.sec.gov      │
│ Cline      │      │                        │      │ (EDGAR)          │
└────────────┘      │ - MCP JSON-RPC handler │      └──────────────────┘
   POST /mcp        │ - API-key + quota      │            ▲
   Bearer <key>     │ - KV cache (TTL 1h–24h)│            │
                    │ - tool handlers        │      ┌─────┴─────┐
                    └────────────┬───────────┘      │ KV CACHE  │
                                 │                  │ KV USAGE  │
                                 ▼                  └───────────┘
                          JSON-RPC response
```

- **Stateless Worker** — every request loads identity from `Authorization` header.
- **KV cache** — 1-hour TTL for current filings, 24-hour for older ones, 365-day for things that never change (company name, CIK).
- **Polite to SEC** — sends `User-Agent: <your-name> <your-email>` (mandated by SEC fair-use), and respects `Retry-After` on 429s.
- **Free-tier-only infra** — 100k req/day on Workers + 100k reads/day on KV is the binding constraint at ~$3k+ MRR.

---

## Repo layout

```
sec-edgar-mcp/
├── README.md             ← this file
├── CHANGELOG.md          ← versioned releases
├── LICENSE               ← MIT
├── package.json
├── wrangler.toml
├── tsconfig.json
├── smithery.json         ← Smithery listing manifest
├── src/
│   ├── index.ts          ← Worker entrypoint
│   ├── edgar.ts          ← EDGAR API client
│   ├── tools.ts          ← MCP tool definitions
│   ├── auth.ts           ← (vendored from _template)
│   ├── cache.ts          ← (vendored from _template)
│   ├── billing.ts        ← (vendored from _template) — move to private repo
│   └── mcp-server.ts     ← (vendored from _template)
├── test/
│   ├── tools.test.ts     ← Vitest tests against fabricated fixtures
│   └── fixtures/         ← saved JSON responses
├── docs/
│   ├── TOOLS.md          ← per-tool API reference (this is what agents read!)
│   └── DISTRIBUTION.md   ← Smithery / Glama / Cursor listing notes
└── .github/workflows/
    ├── ci.yml
    └── deploy.yml
```

---

## Open-source split

- **This repo (public)** — MCP shim, tool *schemas*, basic EDGAR client, free-tier handlers, fixtures.
- **`sec-edgar-mcp-internal` (private)** — premium-tool implementations (8-K subscription, XBRL bulk, alerts), Stripe webhook handler, advanced cache heuristics, eval datasets.

The deployed Worker pulls from both — but only the public part is on GitHub. See [`../../README.md#source-control-split-open-vs-closed`](../../README.md#source-control-split-open-vs-closed) for rationale.

---

## Local dev

```bash
npm install
wrangler kv namespace create CACHE   # one-time
wrangler kv namespace create USAGE   # one-time
# paste IDs into wrangler.toml
echo "your-name your-email@example.com" | wrangler secret put SEC_USER_AGENT

npm run dev                          # http://localhost:8787/mcp
npm test                             # run vitest
npm run typecheck                    # strict TS check
```

## Deploy

```bash
wrangler deploy
```

Live at `https://sec-edgar-mcp.<account>.workers.dev`. Custom-domain instructions in [`../../_template/DEPLOY.md`](../../_template/DEPLOY.md).

## License

MIT — see [LICENSE](LICENSE). The data is from SEC EDGAR and is **public domain**; please respect the SEC's [fair access policy](https://www.sec.gov/os/accessing-edgar-data).

---

## See also

- [`docs/TOOLS.md`](docs/TOOLS.md) — per-tool reference for agents.
- [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) — listing checklist (overrides template defaults).
- [`CHANGELOG.md`](CHANGELOG.md) — release history.
- [`../README.md`](../README.md) — Category 1 pipeline.
- [`../../README.md`](../../README.md) — overall products plan.


---

## Sister MCPs

All from the same operator, all live on `<product>.prakhar-cognizance.workers.dev`, all free-tier friendly:

| Group | Products |
|---|---|
| **Research** | [sec-edgar](https://github.com/guptaprakhariitr/sec-edgar-mcp) · [arxiv](https://github.com/guptaprakhariitr/arxiv-mcp) · [world-bank-economic](https://github.com/guptaprakhariitr/world-bank-economic-mcp) · [uspto-patents](https://github.com/guptaprakhariitr/uspto-patents-mcp) · [fda-approvals](https://github.com/guptaprakhariitr/fda-approvals-mcp) |
| **Verification + Utility** | [verification](https://github.com/guptaprakhariitr/verification-mcp) ⭐ · [unit-converter](https://github.com/guptaprakhariitr/unit-converter-mcp) |
| **India** | [indic-normalize](https://github.com/guptaprakhariitr/indic-normalize-mcp) · [indian-regulatory](https://github.com/guptaprakhariitr/indian-regulatory-mcp) |
| **Real-time** | [hn-trending](https://github.com/guptaprakhariitr/hn-trending-mcp) · [wikipedia-recent-changes](https://github.com/guptaprakhariitr/wikipedia-recent-changes-mcp) · [gdelt-events](https://github.com/guptaprakhariitr/gdelt-events-mcp) · [crypto-prices](https://github.com/guptaprakhariitr/crypto-prices-mcp) |
| **Healthcare** | [drug-interaction](https://github.com/guptaprakhariitr/drug-interaction-mcp) |
| **Logistics** | [multi-carrier-tracking](https://github.com/guptaprakhariitr/multi-carrier-tracking-mcp) |

Full catalog: https://github.com/guptaprakhariitr · ⭐ = empty-quadrant / highest-conviction pick.

