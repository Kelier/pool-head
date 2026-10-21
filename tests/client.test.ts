import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gtm-")), "t.db");

import { TikHubClient, TikHubError, BudgetExceededError, type TikHubConfig } from "../src/lib/tikhub/client";
import { CircuitOpenError, type Clock } from "../src/lib/tikhub/limiter";
import { db } from "../src/lib/db";

const clock: Clock = { now: () => Date.now(), sleep: async () => {} }; // 不真睡，测逻辑
const cfg: TikHubConfig = {
  apiKey: "k", baseUrl: "https://x.test", qps: 100, platformConcurrency: 2, globalConcurrency: 4,
  dailyBudget: 1000, timeoutMs: 1000, maxRetries: 3, jitterMs: [0, 0],
};
const res = (status: number, body: unknown = { ok: 1 }) => new Response(JSON.stringify(body), { status });
const req = { method: "GET" as const, path: "/p", platform: "douyin" };

beforeEach(() => { db().exec("DELETE FROM api_calls; DELETE FROM api_cache;"); });

describe("TikHubClient", () => {
  it("429 重试后成功，共 3 次请求", async () => {
    let n = 0;
    const c = new TikHubClient(cfg, { clock, fetch: (async () => (++n < 3 ? res(429) : res(200))) as typeof fetch });
    await expect(c.request(req)).resolves.toEqual({ ok: 1 });
    expect(n).toBe(3);
  });

  it("重试最多 3 次（共 4 次请求）后抛错", async () => {
    let n = 0;
    const c = new TikHubClient(cfg, { clock, fetch: (async () => (n++, res(500))) as typeof fetch });
    await expect(c.request(req)).rejects.toBeInstanceOf(TikHubError);
    expect(n).toBe(4);
  });

  it("401 不重试并熔断后续请求", async () => {
    let n = 0;
    const c = new TikHubClient(cfg, { clock, fetch: (async () => (n++, res(401))) as typeof fetch });
    await expect(c.request(req)).rejects.toBeInstanceOf(TikHubError);
    await expect(c.request({ ...req, path: "/q" })).rejects.toBeInstanceOf(CircuitOpenError);
    expect(n).toBe(1);
  });

  it("400 不重试", async () => {
    let n = 0;
    const c = new TikHubClient(cfg, { clock, fetch: (async () => (n++, res(400))) as typeof fetch });
    await expect(c.request(req)).rejects.toBeInstanceOf(TikHubError);
    expect(n).toBe(1);
  });

  it("缓存命中不再出站；并发相同请求合并为一次", async () => {
    let n = 0;
    const c = new TikHubClient(cfg, { clock, fetch: (async () => (n++, res(200))) as typeof fetch });
    await Promise.all([c.request({ ...req, ttlMs: 60_000 }), c.request({ ...req, ttlMs: 60_000 })]);
    await c.request({ ...req, ttlMs: 60_000 });
    expect(n).toBe(1);
  });

  it("超出每日预算时不发请求", async () => {
    let n = 0;
    const c = new TikHubClient({ ...cfg, dailyBudget: 2 }, { clock, fetch: (async () => (n++, res(200))) as typeof fetch });
    await c.request({ ...req, path: "/a" });
    await c.request({ ...req, path: "/b" });
    await expect(c.request({ ...req, path: "/c" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(n).toBe(2);
  });

  it("请求头带 Bearer，但日志里不含 key", async () => {
    let auth = "";
    const c = new TikHubClient(cfg, { clock, fetch: (async (_u: unknown, i: RequestInit) => { auth = (i.headers as Record<string, string>).Authorization; return res(200); }) as typeof fetch });
    await c.request(req);
    expect(auth).toBe("Bearer k");
    expect(JSON.stringify(db().prepare("SELECT * FROM api_calls").all())).not.toContain("Bearer");
  });
});

import { describeNetworkError } from "../src/lib/tikhub/client";
import { CircuitBreaker } from "../src/lib/tikhub/limiter";

describe("网络错误提示", () => {
  const cause = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
  it("连接超时 / DNS 失败给出可操作的提示（未配代理时提示 TIKHUB_PROXY）", () => {
    expect(describeNetworkError(cause("UND_ERR_CONNECT_TIMEOUT"))).toMatch(/连接 TikHub 超时.*TIKHUB_PROXY/);
    expect(describeNetworkError(cause("ENOTFOUND"))).toContain("域名解析失败");
    expect(describeNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toContain("请求超时");
  });
  it("已配代理时提示检查代理软件", () => {
    expect(describeNetworkError(cause("ECONNREFUSED"), "http://127.0.0.1:7890")).toContain("请确认代理软件在运行");
  });
  it("熔断错误会带上最近一次失败原因，而不是只说'熔断中'", () => {
    const b = new CircuitBreaker(2, 60_000, 60_000, { now: () => 0, sleep: async () => {} });
    b.failure("连接 TikHub 超时");
    b.failure("连接 TikHub 超时");
    expect(() => b.check()).toThrow(/熔断中.*最近一次错误：连接 TikHub 超时/);
  });
});
