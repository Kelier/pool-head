// 对 TikHub 的唯一出口：限流、并发闸、退避重试、熔断、缓存/合并、预算、调用日志。
import { createHash } from "node:crypto";
import { db } from "../db";
import {
  Semaphore,
  TokenBucket,
  CircuitBreaker,
  CircuitOpenError,
  backoffMs,
  realClock,
  type Clock,
} from "./limiter";

export class TikHubError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}
export class BudgetExceededError extends Error {
  constructor(public used: number, public limit: number) {
    super(`已达今日调用预算 ${used}/${limit}`);
  }
}

export type TikHubConfig = {
  apiKey: string;
  baseUrl: string;
  qps: number;
  platformConcurrency: number;
  globalConcurrency: number;
  dailyBudget: number;
  timeoutMs: number;
  maxRetries: number;
  jitterMs: [number, number];
  /** 可选 HTTP 代理，如 http://127.0.0.1:7890（本机 DNS/网络直连 TikHub 不通时使用） */
  proxy?: string;
};

/** 读取运行参数，供只读页面使用，无需 TikHub 密钥。 */
export function runtimeConfigFromEnv(env = process.env): Omit<TikHubConfig, "apiKey"> {
  const num = (k: string, d: number) => (env[k] && !Number.isNaN(Number(env[k])) ? Number(env[k]) : d);
  return {
    baseUrl: "https://api.tikhub.io",
    qps: Math.min(num("TIKHUB_GLOBAL_QPS", 3), 8), // 官方上限 10，硬顶 8
    platformConcurrency: num("TIKHUB_PLATFORM_CONCURRENCY", 2),
    globalConcurrency: 4,
    dailyBudget: num("TIKHUB_DAILY_BUDGET_CALLS", 5000),
    timeoutMs: num("TIKHUB_TIMEOUT_MS", 45_000),
    maxRetries: Math.min(num("TIKHUB_MAX_RETRIES", 3), 3),
    jitterMs: [50, 300],
    proxy: env.TIKHUB_PROXY?.trim() || undefined,
  };
}

export const TIKHUB_KEY_REQUIRED = "请先配置 TIKHUB_API_KEY，再启动抓取。";

/** 实际调用 TikHub 时才要求密钥。 */
export function configFromEnv(env = process.env): TikHubConfig {
  const apiKey = env.TIKHUB_API_KEY?.trim();
  if (!apiKey) throw new Error(TIKHUB_KEY_REQUIRED);
  return { ...runtimeConfigFromEnv(env), apiKey };
}

/** 从本地记录读取当天实际请求数，不含缓存命中。 */
export function countCallsToday(): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db().prepare("SELECT COUNT(*) c FROM api_calls WHERE cached = 0 AND ts >= ?")
    .get(start.getTime()) as { c: number };
  return row.c;
}

/** 把 undici 的 "fetch failed" 翻译成可操作的提示。 */
export function describeNetworkError(e: unknown, proxy?: string): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code ?? "";
  const hint = proxy ? `（当前代理 ${proxy}，请确认代理软件在运行）` : "（若本机使用代理/VPN 或 DNS 异常，请在 .env 设置 TIKHUB_PROXY=http://127.0.0.1:7890 后重启）";
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `请求超时${hint}`;
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return `连接 TikHub 超时${hint}`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `域名解析失败${hint}`;
  if (code === "ECONNREFUSED") return `连接被拒绝${hint}`;
  if (code === "ECONNRESET") return `连接被重置${hint}`;
  return `网络错误：${err?.cause?.message ?? err?.message ?? "fetch failed"}${hint}`;
}

export type RequestOpts = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  platform: string;
  /** 缓存时长；0/缺省 = 不缓存 */
  ttlMs?: number;
  /** 忽略已有响应，仍写入本次成功结果供后续复用。 */
  bypassCache?: boolean;
  taskId?: number;
};

export type Fetch = typeof fetch;

export class TikHubClient {
  private bucket: TokenBucket;
  private global: Semaphore;
  private perPlatform = new Map<string, Semaphore>();
  private accountBreaker: CircuitBreaker;
  private platformBreakers = new Map<string, CircuitBreaker>();
  private reservedAttempts = 0;
  private inflight = new Map<string, Promise<unknown>>();
  private agent?: import("undici").ProxyAgent;

  constructor(
    private cfg: TikHubConfig,
    private deps: { fetch?: Fetch; clock?: Clock; rand?: () => number } = {},
  ) {
    const clock = deps.clock ?? realClock;
    this.bucket = new TokenBucket(cfg.qps, 1, clock);
    this.global = new Semaphore(cfg.globalConcurrency);
    this.accountBreaker = new CircuitBreaker(5, 60_000, 60_000, clock);
  }

  private get clock() {
    return this.deps.clock ?? realClock;
  }

  /** 今日已发出的真实请求数（不含缓存命中）。 */
  usedToday(): number {
    return countCallsToday();
  }

  async request<T>(o: RequestOpts): Promise<T> {
    const key = cacheKey(o);
    if (o.ttlMs && !o.bypassCache) {
      const hit = db()
        .prepare("SELECT body FROM api_cache WHERE key = ? AND expires_at > ?")
        .get(key, this.clock.now()) as { body: string } | undefined;
      if (hit) {
        this.log(o, 200, 0, true, 0);
        return JSON.parse(hit.body) as T;
      }
    }
    // single-flight：相同请求并发时只发一次
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = this.execute<T>(o, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private sem(platform: string) {
    let s = this.perPlatform.get(platform);
    if (!s) this.perPlatform.set(platform, (s = new Semaphore(this.cfg.platformConcurrency)));
    return s;
  }

  private execute<T>(o: RequestOpts, key: string): Promise<T> {
    return this.global.run(() => this.sem(o.platform).run(() => this.attemptLoop<T>(o, key)));
  }

  /** 平台瞬时故障单独熔断；账号级故障仍由全局熔断器处理。 */
  private platformBreaker(platform: string): CircuitBreaker {
    let breaker = this.platformBreakers.get(platform);
    if (!breaker) {
      breaker = new CircuitBreaker(5, 60_000, 60_000, this.clock);
      this.platformBreakers.set(platform, breaker);
    }
    return breaker;
  }

  private async attemptLoop<T>(o: RequestOpts, key: string): Promise<T> {
    const rand = this.deps.rand ?? Math.random;
    let lastErr: unknown;
    const breaker = this.platformBreaker(o.platform);
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      this.accountBreaker.check();
      breaker.check();
      const used = this.usedToday();
      if (used >= this.cfg.dailyBudget) throw new BudgetExceededError(used, this.cfg.dailyBudget);

      await this.bucket.acquire();
      const [lo, hi] = this.cfg.jitterMs;
      await this.clock.sleep(lo + rand() * (hi - lo));

      // 到实际发送前再检查，给并发中尚未记入 SQLite 的请求保留额度。
      const committed = this.usedToday();
      if (committed + this.reservedAttempts >= this.cfg.dailyBudget) {
        throw new BudgetExceededError(committed + this.reservedAttempts, this.cfg.dailyBudget);
      }
      this.accountBreaker.check();
      const t0 = this.clock.now();
      let status = 0;
      try {
        let res: Response;
        this.reservedAttempts++;
        try {
          res = await this.send(o);
          status = res.status;
          this.log(o, status, this.clock.now() - t0, false, attempt);
        } finally {
          this.reservedAttempts--;
        }

        if (res.ok) {
          breaker.success();
          const json = (await res.json()) as T;
          if (o.ttlMs) {
            db()
              .prepare("INSERT OR REPLACE INTO api_cache(key, body, expires_at) VALUES (?,?,?)")
              .run(key, JSON.stringify(json), this.clock.now() + o.ttlMs);
          }
          return json;
        }
        if (status === 401 || status === 402 || status === 403) {
          this.accountBreaker.fatal(`HTTP ${status}`); // 鉴权/余额/权限：不重试，暂停全部请求
          throw new TikHubError(`TikHub ${status}：鉴权/余额/权限问题，已熔断`, status);
        }
        if (status !== 429 && status < 500) {
          throw new TikHubError(`TikHub ${status}：${(await res.text()).slice(0, 200)}`, status);
        }
        breaker.failure(`HTTP ${status}`);
        lastErr = new TikHubError(`TikHub ${status}`, status);
        if (attempt < this.cfg.maxRetries) {
          await this.clock.sleep(backoffMs(attempt, Number(res.headers.get("retry-after")) || undefined, 1000, rand));
        }
      } catch (e) {
        if (e instanceof TikHubError || e instanceof CircuitOpenError || e instanceof BudgetExceededError) throw e;
        // 网络错误 / 超时
        if (status === 0) this.log(o, status, this.clock.now() - t0, false, attempt);
        const msg = describeNetworkError(e, this.cfg.proxy);
        breaker.failure(msg);
        lastErr = new TikHubError(msg);
        if (attempt < this.cfg.maxRetries) await this.clock.sleep(backoffMs(attempt, undefined, 1000, rand));
      }
    }
    throw lastErr instanceof Error ? lastErr : new TikHubError("请求失败");
  }

  private async send(o: RequestOpts): Promise<Response> {
    const url = new URL(o.path, this.cfg.baseUrl);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    let f: Fetch = this.deps.fetch ?? fetch;
    let extra: Record<string, unknown> = {};
    if (this.cfg.proxy && !this.deps.fetch) {
      // 动态引入，未配置代理时不加载 undici
      const { fetch: ufetch, ProxyAgent } = await import("undici");
      this.agent ??= new ProxyAgent(this.cfg.proxy);
      f = ufetch as unknown as Fetch;
      extra = { dispatcher: this.agent };
    }
    return f(url, {
      ...extra,
      method: o.method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        ...(o.body ? { "Content-Type": "application/json" } : {}),
      },
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
  }

  private log(o: RequestOpts, status: number, ms: number, cached: boolean, attempt: number) {
    // 只记录路径，不记录 Authorization / 完整 URL
    db()
      .prepare("INSERT INTO api_calls(ts, endpoint, status, ms, cached, attempt, task_id) VALUES (?,?,?,?,?,?,?)")
      .run(this.clock.now(), o.path, status, ms, cached ? 1 : 0, attempt, o.taskId ?? null);
  }
}

function cacheKey(o: RequestOpts) {
  const q = Object.entries(o.query ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha1")
    .update(JSON.stringify([o.method, o.path, q, o.body ?? null]))
    .digest("hex");
}

const g = globalThis as unknown as { __tikhub?: TikHubClient };
export function tikhub(): TikHubClient {
  return (g.__tikhub ??= new TikHubClient(configFromEnv()));
}
