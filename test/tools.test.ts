// Vitest suite for sec-edgar-mcp.
//
// Strategy: stub `fetch` to return fixtures from test/fixtures/. We do NOT
// hit the real SEC API in tests (would be slow + brittle + rude).
//
// To regenerate fixtures from real SEC responses:
//   curl -A "your-name your-email@example.com" \
//        https://data.sec.gov/submissions/CIK0000789019.json \
//        > test/fixtures/submissions-msft.json

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgarClient, EIGHT_K_ITEM_LABELS } from "../src/edgar";
import { McpServer, ToolContext } from "../src/mcp-server";
import { buildTools } from "../src/tools";

import tickerMap from "./fixtures/ticker-map.json";
import submissionsMsft from "./fixtures/submissions-msft.json";
import xbrlMsftRevenues from "./fixtures/xbrl-msft-revenues.json";

// Minimal in-memory KV stub. Cast to KVNamespace at the boundary since the
// real type has 5 overloads we don't need to implement.
class FakeKv {
  store = new Map<string, string>();
  async get(key: string, type?: "text" | "json"): Promise<any> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    if (type === "json") return JSON.parse(v);
    return v;
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

const env = {
  CACHE: new FakeKv() as unknown as KVNamespace,
  USAGE: new FakeKv() as unknown as KVNamespace,
  EDGAR_BASE: "https://data.sec.gov",
  EDGAR_WWW_BASE: "https://www.sec.gov",
  SEC_USER_AGENT: "test-runner test@example.com",
  UPGRADE_URL: "https://example.com/upgrade",
};

beforeEach(() => {
  // Reset KV caches between tests so each test gets fresh fetches.
  (env.CACHE as any).store = new Map();
  (env.USAGE as any).store = new Map();

  vi.stubGlobal("fetch", async (url: string | URL | Request, _init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.endsWith("/files/company_tickers.json")) {
      return new Response(JSON.stringify(tickerMap), { status: 200 });
    }
    if (u.endsWith("/submissions/CIK0000789019.json")) {
      return new Response(JSON.stringify(submissionsMsft), { status: 200 });
    }
    if (u.endsWith("/api/xbrl/companyconcept/CIK0000789019/us-gaap/Revenues.json")) {
      return new Response(JSON.stringify(xbrlMsftRevenues), { status: 200 });
    }
    if (u.includes("/Archives/edgar/data/789019/")) {
      // primary document fetch
      return new Response("<html><body>10-K sample content</body></html>", { status: 200 });
    }
    if (u.includes("companyconcept")) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EdgarClient", () => {
  it("resolves ticker -> CIK from the SEC ticker map", async () => {
    const c = new EdgarClient(env as any);
    expect(await c.tickerToCik("MSFT")).toBe("0000789019");
    expect(await c.tickerToCik("msft")).toBe("0000789019");  // case-insensitive
    expect(await c.tickerToCik("ZZZZ")).toBeNull();
  });

  it("returns company metadata by ticker", async () => {
    const c = new EdgarClient(env as any);
    const co = await c.getCompany("MSFT");
    expect(co).not.toBeNull();
    expect(co!.cik).toBe("0000789019");
    expect(co!.name).toBe("MICROSOFT CORP");
    expect(co!.exchanges).toEqual(["Nasdaq"]);
  });

  it("searches filings filtered by form type", async () => {
    const c = new EdgarClient(env as any);
    const all = await c.searchFilings({ ticker: "MSFT" });
    const eightK = await c.searchFilings({ ticker: "MSFT", formType: "8-K" });
    const tenK = await c.searchFilings({ ticker: "MSFT", formType: "10-K" });
    expect(all.length).toBe(4);
    expect(eightK.length).toBe(1);
    expect(eightK[0].formType).toBe("8-K");
    expect(tenK.length).toBe(1);
  });

  it("filters filings by date range", async () => {
    const c = new EdgarClient(env as any);
    const recent = await c.searchFilings({
      ticker: "MSFT",
      dateFrom: "2024-07-01",
    });
    expect(recent.length).toBe(2); // 10-K (2024-07-30) + 8-K (2024-07-15)
    expect(recent.every((f) => f.filingDate >= "2024-07-01")).toBe(true);
  });

  it("returns XBRL facts and prefers latest-filed for amendments", async () => {
    // The fixture has two FY2024 entries: original 10-K filed 2024-07-30,
    // and 10-K/A filed 2024-09-12 with the same value. Bug fixed in 0.3.1:
    // we must prefer the latest-filed for each (fy, fp) pair.
    const c = new EdgarClient(env as any);
    const facts = await c.getConceptFacts({ ticker: "MSFT", concept: "Revenues" });
    const fy2024 = facts.filter((f) => f.fiscalYear === 2024);
    expect(fy2024.length).toBe(1);
    expect(fy2024[0].formType).toBe("10-K/A");
    expect(fy2024[0].filed).toBe("2024-09-12");
    expect(fy2024[0].value).toBe(245122000000);
  });

  it("accepts common-name aliases for concepts", async () => {
    const c = new EdgarClient(env as any);
    const facts = await c.getConceptFacts({ ticker: "MSFT", concept: "revenue" });
    expect(facts.length).toBe(3); // FY22, FY23, FY24
    expect(facts[0].concept).toBe("Revenues");
  });

  it("returns sorted facts (newest first)", async () => {
    const c = new EdgarClient(env as any);
    const facts = await c.getConceptFacts({ ticker: "MSFT", concept: "Revenues" });
    expect(facts.map((f) => f.fiscalYear)).toEqual([2024, 2023, 2022]);
  });

  it("requires SEC_USER_AGENT to be set", async () => {
    const badEnv = { ...env, SEC_USER_AGENT: "" };
    const c = new EdgarClient(badEnv as any);
    await expect(c.tickerToCik("MSFT")).rejects.toThrow(/SEC_USER_AGENT/);
  });

  it("returns null for unknown tickers", async () => {
    const c = new EdgarClient(env as any);
    expect(await c.tickerToCik("NOTREAL")).toBeNull();
    expect(await c.getCompany("NOTREAL")).toBeNull();
  });
});

describe("McpServer protocol", () => {
  const server = new McpServer({ name: "sec-edgar-mcp", version: "0.3.1" });
  for (const t of buildTools()) server.register(t);

  const ctx: ToolContext = {
    env: env as any,
    apiKey: null,
    tier: "free",
    callsRemaining: 100,
  };

  it("responds to initialize", async () => {
    const r = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ctx);
    expect(r).not.toBeNull();
    expect((r!.result as any).serverInfo.name).toBe("sec-edgar-mcp");
  });

  it("lists tools on free tier (hides premium)", async () => {
    const r = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx);
    const names = (r!.result as any).tools.map((t: any) => t.name) as string[];
    expect(names).toContain("edgar_search_filings");
    expect(names).toContain("edgar_get_facts");
    expect(names).not.toContain("edgar_get_insider_trades"); // premium, hidden on free
  });

  it("exposes premium tools on team tier", async () => {
    const teamCtx = { ...ctx, tier: "team" as const };
    const r = await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }, teamCtx);
    const names = (r!.result as any).tools.map((t: any) => t.name) as string[];
    expect(names).toContain("edgar_get_insider_trades");
  });

  it("rejects premium tool calls from free tier", async () => {
    const r = await server.handle(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "edgar_get_insider_trades", arguments: { ticker: "MSFT" } } },
      ctx
    );
    expect(r!.error).toBeDefined();
    expect(r!.error!.message).toMatch(/premium/i);
  });

  it("returns 'Method not found' for unknown methods", async () => {
    const r = await server.handle({ jsonrpc: "2.0", id: 5, method: "bogus/method" }, ctx);
    expect(r!.error!.code).toBe(-32601);
  });

  it("returns null for notifications/initialized (no response)", async () => {
    const r = await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx);
    expect(r).toBeNull();
  });

  it("calls edgar_get_company tool end-to-end", async () => {
    const r = await server.handle(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "edgar_get_company", arguments: { ticker_or_cik: "MSFT" } } },
      ctx
    );
    expect(r!.error).toBeUndefined();
    const content = (r!.result as any).content[0].text;
    expect(content).toContain("MICROSOFT CORP");
    expect(content).toContain("0000789019");
  });

  it("calls edgar_search_filings tool end-to-end", async () => {
    const r = await server.handle(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "edgar_search_filings", arguments: { ticker: "MSFT", form_type: "10-K" } } },
      ctx
    );
    const content = (r!.result as any).content[0].text;
    const parsed = JSON.parse(content);
    expect(parsed.count).toBe(1);
    expect(parsed.filings[0].formType).toBe("10-K");
  });
});

describe("8-K eventType classification", () => {
  it("maps known item codes to eventType labels", () => {
    expect(EIGHT_K_ITEM_LABELS["5.02"]).toBe("executive_change");
    expect(EIGHT_K_ITEM_LABELS["4.01"]).toBe("auditor_change");
    expect(EIGHT_K_ITEM_LABELS["2.01"]).toBe("completion_of_acquisition");
  });
});
