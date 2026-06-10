// MCP tool definitions for sec-edgar-mcp.
// These wrap EdgarClient methods and add input schema + agent-facing descriptions.
// Tool *descriptions* matter — they are what the LLM reads to decide whether
// to call your tool. Write them like API doc for a smart but uninformed coworker.

import { EdgarClient, EdgarEnv } from "./edgar";
import { Tool } from "./mcp-server";

export function buildTools(): Tool[] {
  return [
    {
      name: "edgar_search_filings",
      description:
        "Search SEC EDGAR filings for a US-listed company. Returns recent filings (10-K, 10-Q, 8-K, S-1, Form 4, etc.) filtered by ticker or CIK, form type, and date range. Use this when the user asks 'what did <company> file' or needs to find a specific filing.",
      inputSchema: {
        type: "object",
        properties: {
          ticker:    { type: "string", description: "Stock ticker, e.g. 'MSFT'. Provide either ticker OR cik." },
          cik:       { type: "string", description: "10-digit CIK number (zero-padded). Provide either ticker OR cik." },
          form_type: { type: "string", description: "Optional form type filter, e.g. '10-K', '8-K', '4'. Prefix-matched, so '10-K' matches '10-K' and '10-K/A'." },
          date_from: { type: "string", description: "Optional ISO date YYYY-MM-DD; only filings on or after this date." },
          date_to:   { type: "string", description: "Optional ISO date YYYY-MM-DD; only filings on or before this date." },
          limit:     { type: "integer", description: "Max filings to return (default 25, max 200).", default: 25, minimum: 1, maximum: 200 },
        },
        required: [],
      },
      handler: async (args, ctx) => {
        const c = new EdgarClient(ctx.env as EdgarEnv);
        const filings = await c.searchFilings({
          ticker: args.ticker,
          cik: args.cik,
          formType: args.form_type,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          limit: Math.min(args.limit ?? 25, 200),
        });
        return { count: filings.length, filings };
      },
    },

    {
      name: "edgar_read_filing",
      description:
        "Fetch the full text (HTML) of a specific filing by accession number. Useful when the user wants to read the actual content of a 10-K/8-K. Truncates at ~80K characters; use search to narrow first.",
      inputSchema: {
        type: "object",
        properties: {
          accession_number: { type: "string", description: "Accession number, e.g. '0001564590-24-029333'." },
          ticker:           { type: "string", description: "Stock ticker (used to resolve the CIK; pass either this or cik)." },
          cik:              { type: "string", description: "10-digit CIK (zero-padded). Used to construct the document URL." },
        },
        required: ["accession_number"],
      },
      handler: async (args, ctx) => {
        const c = new EdgarClient(ctx.env as EdgarEnv);
        return c.readFiling({
          accessionNumber: args.accession_number,
          ticker: args.ticker,
          cik: args.cik,
        });
      },
    },

    {
      name: "edgar_get_facts",
      description:
        "Get XBRL-structured financial facts for a company (revenue, operating income, net income, cash, assets, etc.). Accepts common-name aliases ('revenue', 'eps') OR XBRL concepts ('Revenues', 'EarningsPerShareDiluted'). Returns one row per (fiscal_year, fiscal_period), preferring latest-filed when amendments exist.",
      inputSchema: {
        type: "object",
        properties: {
          ticker:  { type: "string", description: "Stock ticker, e.g. 'MSFT'." },
          cik:     { type: "string", description: "10-digit CIK. Provide either ticker OR cik." },
          concept: {
            type: "string",
            description:
              "Financial concept. Common aliases: 'revenue', 'operating_income', 'net_income', 'cash', 'total_assets', 'total_liabilities', 'eps', 'eps_basic'. Or pass an XBRL us-gaap concept directly (e.g. 'Revenues').",
          },
        },
        required: ["concept"],
      },
      handler: async (args, ctx) => {
        const c = new EdgarClient(ctx.env as EdgarEnv);
        const facts = await c.getConceptFacts({
          ticker: args.ticker,
          cik: args.cik,
          concept: args.concept,
        });
        return { count: facts.length, facts };
      },
    },

    {
      name: "edgar_get_8k",
      description:
        "Recent 8-K material event filings for a company, with classified event types ('material_acquisition', 'executive_change', 'auditor_change', 'results_of_operations', etc.). Use this when the user asks 'has anything material happened with <company>'.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          cik:    { type: "string" },
          since:  { type: "string", description: "Only return 8-Ks filed on or after this ISO date (YYYY-MM-DD). Default = last 90 days." },
          limit:  { type: "integer", default: 25, minimum: 1, maximum: 200 },
        },
        required: [],
      },
      handler: async (args, ctx) => {
        const c = new EdgarClient(ctx.env as EdgarEnv);
        const since = args.since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const filings = await c.get8K({ ticker: args.ticker, cik: args.cik, since, limit: args.limit ?? 25 });
        return { count: filings.length, filings };
      },
    },

    {
      name: "edgar_get_company",
      description:
        "Company metadata by ticker or CIK: legal name, SIC industry classification, exchanges listed, fiscal year end. Use this when the user wants to know who/what a company is, before drilling into filings.",
      inputSchema: {
        type: "object",
        properties: {
          ticker_or_cik: { type: "string", description: "Either a stock ticker (e.g. 'MSFT') or a CIK number." },
        },
        required: ["ticker_or_cik"],
      },
      handler: async (args, ctx) => {
        const c = new EdgarClient(ctx.env as EdgarEnv);
        const company = await c.getCompany(args.ticker_or_cik);
        return company ?? { error: "Company not found in SEC ticker map" };
      },
    },

    {
      name: "edgar_get_insider_trades",
      description:
        "Recent Form 4 insider-trading filings (officers, directors, 10% owners). Returns date, insider name, role, and direction (buy/sell) when parseable. Premium tool — requires Team tier or higher.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          cik:    { type: "string" },
          limit:  { type: "integer", default: 20, minimum: 1, maximum: 100 },
        },
        required: [],
      },
      premium: true,
      handler: async (args, ctx) => {
        const c = new EdgarClient(ctx.env as EdgarEnv);
        const trades = await c.getInsiderTrades({ ticker: args.ticker, cik: args.cik, limit: args.limit ?? 20 });
        return { count: trades.length, trades };
      },
    },
  ];
}
