import type { Role } from "./types";

const list = (v?: string) => new Set((v ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));

/**
 * 默认拒绝：既不在管理员、也不在允许用户/群里的人，一律 none。
 * - FEISHU_ADMIN_OPEN_IDS：可抓取（会消耗 TikHub 调用）、改订阅
 * - FEISHU_ALLOWED_USERS / FEISHU_ALLOWED_CHATS：只读查询与导出
 */
export function roleOf(userId: string, chatId: string, env: Record<string, string | undefined> = process.env): Role {
  if (list(env.FEISHU_ADMIN_OPEN_IDS).has(userId)) return "admin";
  if (list(env.FEISHU_ALLOWED_USERS).has(userId) || list(env.FEISHU_ALLOWED_CHATS).has(chatId)) return "member";
  return "none";
}

/** 滑动窗口限流：每个 key 在 windowMs 内最多 max 次。 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  reset() {
    this.hits.clear();
  }
  allow(key: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    return true;
  }
}
