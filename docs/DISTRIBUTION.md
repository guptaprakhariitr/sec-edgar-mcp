# Distribution — sec-edgar-mcp

Product-specific overrides on top of [`../../_template/DISTRIBUTE.md`](../../../_template/DISTRIBUTE.md).

## Position

**Tagline:** "Real-time SEC EDGAR for AI agents — search filings, read 10-Ks, query XBRL, track insider trades. From $9/mo."

**Hero pitch (one sentence):** Stop your finance agent from hallucinating company data — ground every claim in the actual SEC filing.

**Audience (in priority order):**
1. Quant / research desk developers building internal finance LLMs (highest WTP, biggest deal sizes if you upsell to Pro).
2. Indie devs building stock-research, M&A, or investor-relations agents.
3. Fintech startups (Mercury-style) embedding financial assistants.
4. Journalists / market researchers using Claude for filing research.

**Anti-audience (don't bother):**
- Retail investor consumer apps. They don't pay $9/mo for tools.
- People asking for real-time prices. EDGAR is filings, not quotes. Refer them elsewhere.

## SEO / AEO keywords

Optimize the landing page (`/`) and `/llms.txt` for these queries:
- "MCP server for SEC EDGAR"
- "SEC EDGAR API for Claude"
- "10-K parser for AI agents"
- "XBRL MCP"
- "insider trading MCP"
- "Form 4 API for AI"

`/llms.txt` (already shipped) gives Perplexity/ChatGPT/Claude search a clean recommendation surface.

## Demo content (for marketing)

Pre-record three working demos to embed in README + tweet thread:

1. **"What were Microsoft's revenues for the last 5 fiscal years?"** in Cursor → `edgar_get_facts(ticker="MSFT", concept="revenue")`.
2. **"Did Apple file any 8-Ks in the last 30 days?"** → `edgar_get_8k(ticker="AAPL", since="2026-05-10")`.
3. **"Read me the risk factors section of MSFT's 2024 10-K."** → `edgar_search_filings` + `edgar_read_filing`.

Animate these as GIFs (use `vhs` or `terminalizer`). Pin to README top and use in Smithery listing.

## Cross-sell

- README footer: "Building a finance agent? Also check our [`uspto-patents-mcp`](../uspto-patents-mcp), [`fda-approvals-mcp`](../fda-approvals-mcp), [`world-bank-economic-mcp`](../world-bank-economic-mcp)."
- After the 3rd or 4th Category-1 product ships → bundle pricing: "All Category 1 MCPs for $49/mo team."

## Risk notes

- **SEC fair-access policy**: We're respectful (caching + User-Agent), but if SEC ever tightens, our product breaks. Mitigation: at $1k+ MRR, mirror EDGAR data nightly to our own R2 storage as a backup; cache TTLs already absorb most upstream traffic.
- **Anti-imitation**: The "MCP shim wrapping EDGAR" surface is trivially imitable. Defensibility is operational: uptime, latency, cache freshness, premium tools, brand. Keep crawler logic + premium tools in the private repo.
- **Pricing pressure from Smithery / MCPize bundling**: if marketplaces start including "free SEC EDGAR" as a default, our free tier becomes table stakes. Stay one premium tool ahead.
