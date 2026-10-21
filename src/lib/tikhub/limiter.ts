// 限流原语：令牌桶、并发闸、熔断器。纯逻辑，可注入时钟，便于测试。

export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** 令牌桶：rate 个/秒，突发容量 burst。acquire 按 FIFO 排队，保证出站不超速。 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private rate: number,
    private burst = 1,
    private clock: Clock = realClock,
  ) {
    this.tokens = burst;
    this.last = clock.now();
  }

  acquire(): Promise<void> {
    const p = this.queue.then(() => this.take());
    this.queue = p.catch(() => {});
    return p;
  }

  private async take() {
    for (;;) {
      const now = this.clock.now();
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.clock.sleep(Math.ceil(((1 - this.tokens) / this.rate) * 1000));
    }
  }
}

/** 并发闸：同时在飞的请求不超过 limit。 */
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(public retryAfterMs: number, public fatal = false, detail?: string) {
    super(
      (fatal ? "熔断：鉴权/余额错误，已暂停" : `熔断中，${Math.ceil(retryAfterMs / 1000)}s 后重试`) + (detail ? `。最近一次错误：${detail}` : ""),
    );
  }
}

/** 熔断：窗口内连续失败达到阈值即打开；到期后半开放行一次探测。fatal 直接长时间打开。 */
export class CircuitBreaker {
  private failures: number[] = [];
  private openUntil = 0;
  private fatalOpen = false;
  private lastError = "";

  constructor(
    private threshold = 5,
    private windowMs = 60_000,
    private cooldownMs = 60_000,
    private clock: Clock = realClock,
  ) {}

  check() {
    if (this.fatalOpen) throw new CircuitOpenError(0, true, this.lastError);
    const now = this.clock.now();
    if (now < this.openUntil) throw new CircuitOpenError(this.openUntil - now, false, this.lastError);
  }

  success() {
    this.failures = [];
    this.openUntil = 0;
  }

  failure(reason = "") {
    if (reason) this.lastError = reason;
    const now = this.clock.now();
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.threshold) {
      this.openUntil = now + this.cooldownMs;
      this.failures = [];
    }
  }

  fatal(reason = "") {
    if (reason) this.lastError = reason;
    this.fatalOpen = true;
  }

  get isFatal() {
    return this.fatalOpen;
  }
}

/** 退避时长：base * 2^attempt，叠加 ±20% 抖动；Retry-After 优先。 */
export function backoffMs(attempt: number, retryAfterSec?: number, base = 1000, rand = Math.random) {
  if (retryAfterSec && retryAfterSec > 0) return retryAfterSec * 1000;
  const d = base * 2 ** attempt;
  return Math.round(d * (0.8 + rand() * 0.4));
}
