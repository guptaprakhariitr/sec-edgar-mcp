// SEC EDGAR API client.
// Open-source. The thin wrapper part stays here; advanced cache heuristics and
// XBRL bulk parsing live in the private repo.
//
// SEC requires a polite User-Agent. Set the SEC_USER_AGENT secret to e.g.
// "your-name your-email@example.com" — *not* setting this WILL get you 429'd.
// See: https://www.sec.gov/os/accessing-edgar-data

import { KvCache, stableKey } from "./cache";

export interface EdgarEnv {
  CACHE: KVNamespace;
  EDGAR_BASE: string;        // https://data.sec.gov
  EDGAR_WWW_BASE: string;    // https://www.sec.gov
  SEC_USER_AGENT: string;
}

export interface FilingSummary {
  accessionNumber: string;
  filingDate: string;        // YYYY-MM-DD
  reportDate: string;        // YYYY-MM-DD or ""
  formType: string;          // "10-K", "8-K", "4", etc.
  primaryDocument: string;
  primaryDocumentUrl: string;
  filerCik: string;
  filerName: string;
  isAmendment: boolean;
}

export interface CompanySummary {
  cik: string;               // zero-padded to 10 digits
  ticker?: string;
  name: string;              // canonical company name
  sic?: string;              // industry classification
  sicDescription?: string;
  exchanges?: string[];
  fiscalYearEnd?: string;    // MMDD
}

export interface XbrlFact {
  concept: string;
  unit: string;              // USD, USD/shares, shares, etc.
  value: number;
  fiscalYear: number;
  fiscalPeriod: string;      // FY, Q1, Q2, Q3, Q4
  filed: string;             // YYYY-MM-DD
  formType: string;
  accessionNumber: string;
}

const FACT_ALIASES: Record<string, string> = {
  revenue: "Revenues",
  total_revenue: "Revenues",
  net_revenue: "Revenues",
  operating_income: "OperatingIncomeLoss",
  net_income: "NetIncomeLoss",
  cash: "CashAndCashEquivalentsAtCarryingValue",
  total_assets: "Assets",
  total_liabilities: "Liabilities",
  eps: "EarningsPerShareDiluted",
  eps_basic: "EarningsPerShareBasic",
};

// Item-number → eventType for 8-K classification.
// Item codes are stable across 8-K filings; see Form 8-K instructions.
const EIGHT_K_ITEM_LABELS: Record<string, string> = {
  "1.01": "material_definitive_agreement",
  "1.02": "termination_of_material_agreement",
  "2.01": "completion_of_acquisition",
  "2.02": "results_of_operations",
  "2.03": "creation_of_obligation",
  "2.05": "exit_costs_or_disposal",
  "2.06": "material_impairment",
  "3.01": "delisting_notice",
  "3.02": "unregistered_sale_of_equity",
  "3.03": "modification_of_security_holder_rights",
  "4.01": "auditor_change",
  "4.02": "non_reliance_on_prior_filings",
  "5.01": "change_in_control",
  "5.02": "executive_change",
  "5.03": "amendment_to_charter_or_bylaws",
  "5.07": "shareholder_vote_results",
  "7.01": "regulation_fd_disclosure",
  "8.01": "other_events",
  "9.01": "financial_statements_and_exhibits",
};

export class EdgarClient {
  private cache: KvCache;
  constructor(private env: EdgarEnv) {
    this.cache = new KvCache(env.CACHE, "edgar");
  }

  // ── Public-API wrappers ──────────────────────────────────────────────────

  /** Resolve a ticker (e.g. "MSFT") to a zero-padded CIK string. */
  async tickerToCik(ticker: string): Promise<string | null> {
    const t = ticker.toUpperCase().trim();
    const map = await this.cache.memoize(
      "ticker-map",
      60 * 60 * 24, // 24h
      async () => {
        const r = await this.fetch(`${this.env.EDGAR_WWW_BASE}/files/company_tickers.json`);
        if (!r.ok) throw new Error(`SEC ticker map fetch failed: ${r.status}`);
        const json = (await r.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
        const out: Record<string, { cik: string; name: string }> = {};
        for (const k of Object.keys(json)) {
          const e = json[k];
          out[e.ticker.toUpperCase()] = {
            cik: String(e.cik_str).padStart(10, "0"),
            name: e.title,
          };
        }
        return out;
      }
    );
    return map[t]?.cik ?? null;
  }

  /** Company submissions endpoint. */
  async getCompanySubmissions(cik: string): Promise<any> {
    const padded = cik.padStart(10, "0");
    return this.cache.memoize(
      `submissions:${padded}`,
      60 * 60, // 1h
      async () => {
        const r = await this.fetch(`${this.env.EDGAR_BASE}/submissions/CIK${padded}.json`);
        if (!r.ok) throw new Error(`EDGAR submissions fetch failed for CIK${padded}: ${r.status}`);
        return r.json();
      }
    );
  }

  async getCompany(tickerOrCik: string): Promise<CompanySummary | null> {
    const cik = /^\d+$/.test(tickerOrCik) ? tickerOrCik.padStart(10, "0") : await this.tickerToCik(tickerOrCik);
    if (!cik) return null;
    const sub = await this.getCompanySubmissions(cik);
    return {
      cik,
      ticker: sub.tickers?.[0],
      name: sub.name,
      sic: sub.sic,
      sicDescription: sub.sicDescription,
      exchanges: sub.exchanges,
      fiscalYearEnd: sub.fiscalYearEnd,
    };
  }

  /** Search filings for a company. */
  async searchFilings(opts: {
    ticker?: string;
    cik?: string;
    formType?: string;
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;
    limit?: number;
  }): Promise<FilingSummary[]> {
    const cik = opts.cik ?? (opts.ticker ? await this.tickerToCik(opts.ticker) : null);
    if (!cik) return [];
    const padded = cik.padStart(10, "0");
    const cacheKey = `search:${stableKey({ padded, ...opts })}`;
    return this.cache.memoize(cacheKey, 60 * 60, async () => {
      const sub = await this.getCompanySubmissions(padded);
      const recent = sub.filings?.recent;
      if (!recent) return [];
      const filings: FilingSummary[] = [];
      for (let i = 0; i < recent.accessionNumber.length; i++) {
        const formType: string = recent.form[i];
        const filingDate: string = recent.filingDate[i];
        if (opts.formType && !formType.toUpperCase().startsWith(opts.formType.toUpperCase())) continue;
        if (opts.dateFrom && filingDate < opts.dateFrom) continue;
        if (opts.dateTo && filingDate > opts.dateTo) continue;
        filings.push({
          accessionNumber: recent.accessionNumber[i],
          filingDate,
          reportDate: recent.reportDate[i] || "",
          formType,
          primaryDocument: recent.primaryDocument[i],
          primaryDocumentUrl: this.docUrl(padded, recent.accessionNumber[i], recent.primaryDocument[i]),
          filerCik: padded,
          filerName: sub.name,
          isAmendment: formType.includes("/A"),
        });
        if (filings.length >= (opts.limit ?? 50)) break;
      }
      return filings;
    });
  }

  /** XBRL company-concept facts for a single concept. */
  async getConceptFacts(opts: { ticker?: string; cik?: string; concept: string }): Promise<XbrlFact[]> {
    const cik = opts.cik ?? (opts.ticker ? await this.tickerToCik(opts.ticker) : null);
    if (!cik) return [];
    const padded = cik.padStart(10, "0");
    const concept = FACT_ALIASES[opts.concept.toLowerCase()] ?? opts.concept;
    const cacheKey = `concept:${padded}:${concept}`;
    return this.cache.memoize(cacheKey, 60 * 60 * 6, async () => {
      const r = await this.fetch(
        `${this.env.EDGAR_BASE}/api/xbrl/companyconcept/CIK${padded}/us-gaap/${concept}.json`
      );
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`XBRL fetch failed: ${r.status}`);
      const json: any = await r.json();
      const out: XbrlFact[] = [];
      const units = json.units ?? {};
      for (const unit of Object.keys(units)) {
        for (const entry of units[unit]) {
          if (!entry.fy || !entry.fp) continue;
          out.push({
            concept,
            unit,
            value: entry.val,
            fiscalYear: entry.fy,
            fiscalPeriod: entry.fp,
            filed: entry.filed,
            formType: entry.form,
            accessionNumber: entry.accn,
          });
        }
      }
      // Prefer latest-filed for each (fy, fp) pair (handles 10-K/A amendments — bug fixed in 0.3.1).
      const dedup = new Map<string, XbrlFact>();
      for (const f of out) {
        const k = `${f.fiscalYear}:${f.fiscalPeriod}`;
        const prev = dedup.get(k);
        if (!prev || prev.filed < f.filed) dedup.set(k, f);
      }
      return Array.from(dedup.values()).sort(
        (a, b) => b.fiscalYear - a.fiscalYear || b.filed.localeCompare(a.filed)
      );
    });
  }

  /** 8-K filings with event classification. */
  async get8K(opts: { ticker?: string; cik?: string; since?: string; limit?: number }): Promise<
    Array<FilingSummary & { eventType: string; itemNumbers: string[] }>
  > {
    const filings = await this.searchFilings({
      ...opts,
      formType: "8-K",
      dateFrom: opts.since,
    });
    return filings.map((f) => {
      // The item numbers are in the submissions JSON's "items" parallel array.
      // We approximate by stripping form code; full classification lives in the
      // private repo's deeper 8-K parser. For the public version we expose
      // "unclassified" if items aren't known.
      const items: string[] = [];
      return {
        ...f,
        itemNumbers: items,
        eventType: items[0] ? EIGHT_K_ITEM_LABELS[items[0]] ?? "other" : "unclassified",
      };
    });
  }

  /** Insider trades (Form 4). Premium-tier tool. */
  async getInsiderTrades(opts: { ticker?: string; cik?: string; limit?: number }): Promise<
    Array<{
      filingDate: string;
      insider: string;
      role?: string;
      direction: "buy" | "sell" | "unknown";
      accessionNumber: string;
    }>
  > {
    const filings = await this.searchFilings({
      ticker: opts.ticker,
      cik: opts.cik,
      formType: "4",
      limit: opts.limit ?? 20,
    });
    // Full Form-4 XML parsing lives in the private repo. This stub returns the
    // raw filing list; agents can fall back to `edgar_read_filing` for detail.
    return filings.map((f) => ({
      filingDate: f.filingDate,
      insider: f.filerName,
      direction: "unknown" as const,
      accessionNumber: f.accessionNumber,
    }));
  }

  /** Construct the URL for a primary document. */
  docUrl(cik: string, accessionNumber: string, primaryDoc: string): string {
    const accNoDash = accessionNumber.replace(/-/g, "");
    return `${this.env.EDGAR_WWW_BASE}/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/${primaryDoc}`;
  }

  /** Fetch the text of a filing (best-effort; HTML is returned as-is). */
  async readFiling(opts: { accessionNumber: string; cik?: string; ticker?: string }): Promise<{
    accessionNumber: string;
    formType?: string;
    text: string;
    truncated: boolean;
    sourceUrl: string;
  }> {
    const cik = opts.cik ?? (opts.ticker ? await this.tickerToCik(opts.ticker) : null);
    if (!cik) throw new Error("cik or ticker required");
    // Resolve primary doc via submissions.
    const sub = await this.getCompanySubmissions(cik);
    const recent = sub.filings?.recent;
    let idx = -1;
    for (let i = 0; i < recent.accessionNumber.length; i++) {
      if (recent.accessionNumber[i] === opts.accessionNumber) {
        idx = i;
        break;
      }
    }
    if (idx < 0) throw new Error("filing not found in recent submissions");
    const url = this.docUrl(cik, opts.accessionNumber, recent.primaryDocument[idx]);
    const r = await this.fetch(url);
    if (!r.ok) throw new Error(`filing fetch failed: ${r.status}`);
    const raw = await r.text();
    const MAX = 80_000; // tokens-of-text-ish budget for an MCP response
    const text = raw.length > MAX ? raw.slice(0, MAX) : raw;
    return {
      accessionNumber: opts.accessionNumber,
      formType: recent.form[idx],
      text,
      truncated: raw.length > MAX,
      sourceUrl: url,
    };
  }

  // ── Low-level fetch with SEC-friendly headers ────────────────────────────

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.env.SEC_USER_AGENT) {
      throw new Error(
        "SEC_USER_AGENT not configured. Set it via `wrangler secret put SEC_USER_AGENT` to e.g. 'your-name your-email@example.com'."
      );
    }
    const headers = new Headers(init.headers);
    headers.set("User-Agent", this.env.SEC_USER_AGENT);
    headers.set("Accept", "application/json, text/html;q=0.9, */*;q=0.5");
    headers.set("Accept-Encoding", "gzip, deflate");
    const r = await fetch(url, { ...init, headers });
    if (r.status === 429) {
      // SEC's rate limit. We do not retry here; the cache layer absorbs most
      // repeat requests, and the caller will see the 429 with Retry-After.
      const retryAfter = r.headers.get("Retry-After") || "10";
      throw new Error(`SEC rate limit (429); retry after ${retryAfter}s`);
    }
    return r;
  }
}

export { EIGHT_K_ITEM_LABELS, FACT_ALIASES };
