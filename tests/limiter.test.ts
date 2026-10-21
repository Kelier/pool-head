import { describe, it, expect } from "vitest";
import { TokenBucket, Semaphore, CircuitBreaker, CircuitOpenError, backoffMs, type Clock } from "../src/lib/tikhub/limiter";

function fakeClock(): Clock & { t: number } {
  const c = { t: 0, now: () => c.t, sleep: async (ms: number) => { c.t += ms; } };
  return c;
}

describe("TokenBucket", () => {
  it("30 次请求在 3 QPS 下至少耗时 ~9s（不会超速）", async () => {
    const c = fakeClock();
    const b = new TokenBucket(3, 1, c);
    await Promise.all(Array.from({ length: 30 }, () => b.acquire()));
    expect(c.t).toBeGreaterThanOrEqual(9000);
  });
});

describe("Semaphore", () => {
  it("并发不超过上限", async () => {
    const s = new Semaphore(2);
    let active = 0, max = 0;
    await Promise.all(Array.from({ length: 8 }, () => s.run(async () => {
      active++; max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    })));
    expect(max).toBe(2);
  });
});

describe("CircuitBreaker", () => {
  it("连续失败打开，冷却后恢复", () => {
    const c = fakeClock();
    const b = new CircuitBreaker(3, 60_000, 60_000, c);
    b.failure(); b.failure(); b.check();
    b.failure();
    expect(() => b.check()).toThrow(CircuitOpenError);
    c.t += 61_000;
    expect(() => b.check()).not.toThrow();
  });
  it("fatal 永久打开", () => {
    const b = new CircuitBreaker();
    b.fatal();
    expect(() => b.check()).toThrow(CircuitOpenError);
  });
});

describe("backoffMs", () => {
  it("指数增长且遵守 Retry-After", () => {
    expect(backoffMs(0, undefined, 1000, () => 0.5)).toBe(1000);
    expect(backoffMs(2, undefined, 1000, () => 0.5)).toBe(4000);
    expect(backoffMs(2, 7)).toBe(7000);
  });
});
