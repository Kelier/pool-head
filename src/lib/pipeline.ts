import { db } from "./db";
import { classify } from "./classify";
import { PLATFORMS } from "./platforms";
import { tikhub, configFromEnv, BudgetExceededError } from "./tikhub/client";
import { CircuitOpenError, Semaphore } from "./tikhub/limiter";
import { getSettings } from "./settings";
import { addAlert } from "./alerts";
import type { NormPost, Progress, TaskConfig } from "./types";

const DAY = 86_400_000;

export function resolveRange(t: TaskConfig["time"], now = Date.now()): { from: number; to: number; days: number } {
  if (t.type === "relative") return { from: now - t.days * DAY, to: now, days: t.days };
  const from = new Date(`${t.from}T00:00:00`).getTime();
  const to = new Date(`${t.to}T23:59:59.999`).getTime();
  // 搜索接口只有"最近N天"档位，所以按距今天数取档
  return { from, to, days: Math.max(1, Math.ceil((now - from) / DAY)) };
}

/** 创建任务前估算 TikHub 调用量，用于预算确认。 */
export function estimateCalls(cfg: TaskConfig): number {
  const search = cfg.platforms.length * cfg.keywords.length * cfg.maxPages;
  // 需单独补粉丝数的平台：每个命中账号 1 次调用，粗估 = 每页约 12 个账号
  const accounts = Math.min(100, cfg.keywords.length * cfg.maxPages * 12);
  const enrich = cfg.platforms.reduce((n, p) => n + (PLATFORMS[p].enrichCalls?.() ?? (PLATFORMS[p].followers ? 1 : 0)), 0) * accounts;
  return search + enrich;
}

function setProgress(id: number, p: Progress) {
  db().prepare("UPDATE tasks SET progress = ? WHERE id = ?").run(JSON.stringify(p), id);
}

class Cancelled extends Error {}

/** scope 内各账号当前的（去重后）投放次数，用于判断新增账号 / 新晋复投。 */
function scopeCounts(scope: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT platform || ':' || account_uid k, COUNT(*) c FROM promo_posts
       WHERE rowid IN (SELECT MAX(rowid) FROM promo_posts WHERE scope = ? GROUP BY platform, post_id)
       GROUP BY k`,
    )
    .all(scope) as Array<{ k: string; c: number }>;
  return new Map(rows.map((r) => [r.k, r.c]));
}

export async function runTask(taskId: number): Promise<void> {
  const row = db().prepare("SELECT config, scope, name FROM tasks WHERE id = ?").get(taskId) as
    | { config: string; scope: string; name: string | null }
    | undefined;
  if (!row) throw new Error(`task ${taskId} 不存在`);
  const cfg = JSON.parse(row.config) as TaskConfig;
  const settings = getSettings();
  const range = resolveRange(cfg.time);
  const p: Progress = { stage: "searching", postsSeen: 0, postsMatched: 0, calls: 0 };
  db().prepare("UPDATE tasks SET status='running', error=NULL WHERE id=?").run(taskId);
  const checkCancel = () => {
    const r = db().prepare("SELECT cancel FROM tasks WHERE id=?").get(taskId) as { cancel: number } | undefined;
    if (!r || r.cancel) throw new Cancelled("任务已取消");
  };

  try {
    const before = scopeCounts(row.scope);
    const hits = new Map<string, { post: NormPost; keywords: Set<string>; confidence: number; reasons: string[] }>();

    for (const platform of cfg.platforms) {
      for (const kw of cfg.keywords) {
        let next: Record<string, string | number> | null = null;
        for (let page = 0; page < cfg.maxPages; page++) {
          checkCancel();
          const res = await PLATFORMS[platform].search(kw, range.days, next, taskId);
          p.calls = (p.calls ?? 0) + 1;
          p.postsSeen = (p.postsSeen ?? 0) + res.posts.length;
          for (const post of res.posts) {
            if (post.publishedAt < range.from || post.publishedAt > range.to) continue;
            const c = classify(post, cfg, settings.rules);
            if (!c || c.confidence < cfg.minConfidence) continue;
            const key = `${post.platform}:${post.postId}`;
            const cur = hits.get(key);
            if (cur) {
              c.matchedKeywords.forEach((k) => cur.keywords.add(k));
              cur.confidence = Math.max(cur.confidence, c.confidence);
            } else {
              hits.set(key, { post, keywords: new Set(c.matchedKeywords), confidence: c.confidence, reasons: c.reasons });
            }
          }
          p.postsMatched = hits.size;
          setProgress(taskId, p);
          // 按最新排序：整页都早于起点，后面更早，停止翻页
          const oldest = Math.min(...res.posts.map((x) => x.publishedAt), Infinity);
          if (!res.hasMore || (res.posts.length > 0 && oldest < range.from)) break;
          next = res.next;
        }
      }
    }

    // 账号维度：换出真实账号 → 补粉丝数 → 粉丝/互动过滤 → 入库
    p.stage = "enriching";
    setProgress(taskId, p);
    // 搜索结果没有作者稳定 ID 的平台（视频号）：每个临时账号用一条命中作品换出真实账号。
    // 只对命中的账号做；失败（null）则沿用临时 ID，同一作者的作品仍聚在一起。
    const resolved = new Map<string, { uid: string; name?: string; url?: string } | null>();
    for (const { post } of hits.values()) {
      const resolve = PLATFORMS[post.platform].resolveAccount;
      const k = `${post.platform}:${post.accountUid}`;
      if (!resolve || resolved.has(k)) continue;
      checkCancel();
      resolved.set(k, await resolve(post, taskId));
      p.calls = (p.calls ?? 0) + 1;
    }
    for (const { post } of hits.values()) {
      const r = resolved.get(`${post.platform}:${post.accountUid}`); // 先按旧 ID 查，再改写
      if (!r) continue;
      post.accountUid = r.uid;
      if (r.name) post.accountName = r.name;
      if (r.url !== undefined) post.accountUrl = r.url;
    }
    setProgress(taskId, p);
    const followers = new Map<string, number | null>();
    for (const { post } of hits.values()) {
      const k = `${post.platform}:${post.accountUid}`;
      if (post.followers != null) followers.set(k, post.followers);
      else if (!followers.has(k)) followers.set(k, null);
    }
    for (const [k, v] of followers) {
      if (v !== null) continue;
      checkCancel();
      const i = k.indexOf(":");
      const platform = k.slice(0, i) as TaskConfig["platforms"][number];
      const fn = PLATFORMS[platform]?.followers;
      if (fn) {
        followers.set(k, await fn(k.slice(i + 1), taskId));
        p.calls = (p.calls ?? 0) + 1;
      }
    }

    const d = db();
    const now = Date.now();
    const upAcc = d.prepare(
      `INSERT INTO accounts(platform, uid, name, profile_url, followers, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(platform, uid) DO UPDATE SET name=excluded.name, profile_url=excluded.profile_url,
         followers=COALESCE(excluded.followers, accounts.followers), updated_at=excluded.updated_at`,
    );
    const upPost = d.prepare(
      `INSERT OR REPLACE INTO promo_posts(platform, post_id, task_id, scope, account_uid, url, title, published_at,
         likes, comments, plays, keywords, confidence, reasons, crawled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const accounts = new Set<string>();
    d.exec("BEGIN");
    try {
      for (const h of hits.values()) {
        const { post } = h;
        const f = followers.get(`${post.platform}:${post.accountUid}`) ?? null;
        if (cfg.followers) {
          // 粉丝数未知时保留（宁可多不漏），由 UI 显示"未知"
          if (f != null && cfg.followers.min != null && f < cfg.followers.min) continue;
          if (f != null && cfg.followers.max != null && f > cfg.followers.max) continue;
        }
        if (!PLATFORMS[post.platform].noEngagement) {
          if (cfg.engagement?.minLikes != null && post.likes < cfg.engagement.minLikes) continue;
          if (cfg.engagement?.minComments != null && post.comments < cfg.engagement.minComments) continue;
        }
        upAcc.run(post.platform, post.accountUid, post.accountName, post.accountUrl, f, now);
        upPost.run(
          post.platform, post.postId, taskId, row.scope, post.accountUid, post.url, post.title, post.publishedAt,
          post.likes, post.comments, post.plays, JSON.stringify([...h.keywords]), h.confidence,
          JSON.stringify(h.reasons), now,
        );
        accounts.add(`${post.platform}:${post.accountUid}`);
      }
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }

    // 相对该 scope 历史：新增账号 / 新晋复投
    const after = scopeCounts(row.scope);
    const n = Math.max(2, cfg.repeatThreshold ?? settings.repeatThreshold);
    p.newAccounts = [...accounts].filter((k) => !before.has(k)).length;
    p.newRepeat = [...accounts].filter((k) => (after.get(k) ?? 0) >= n && (before.get(k) ?? 0) < n).length;
    p.repeatAccounts = [...accounts].filter((k) => (after.get(k) ?? 0) >= n).length;
    p.stage = "done";
    p.accounts = accounts.size;
    d.prepare("UPDATE tasks SET status='done', progress=?, finished_at=? WHERE id=?").run(JSON.stringify(p), Date.now(), taskId);

    const label = row.name || `任务 #${taskId}`;
    addAlert("task_done", `「${label}」抓取完成`, `命中 ${accounts.size} 个账号，其中新增 ${p.newAccounts} 个`, `/tasks/${taskId}`);
    if (p.newRepeat) addAlert("new_repeat", `「${label}」新增 ${p.newRepeat} 个高频复投账号`, "这些账号投放次数刚达到复投阈值", `/tasks/${taskId}`);
    const used = tikhub().usedToday();
    const limit = configFromEnv().dailyBudget;
    if (used / limit >= 0.8) addAlert("budget", `今日调用已达预算 ${Math.round((used / limit) * 100)}%`, `${used} / ${limit}`, "/settings");
  } catch (e) {
    const cancelled = e instanceof Cancelled;
    const budget = e instanceof BudgetExceededError;
    const circuit = e instanceof CircuitOpenError;
    p.note = (e as Error).message;
    const status = cancelled ? "cancelled" : budget ? "paused_budget" : circuit ? "paused_circuit" : "failed";
    db()
      .prepare("UPDATE tasks SET status=?, error=?, progress=?, finished_at=? WHERE id=?")
      .run(status, (e as Error).message, JSON.stringify(p), Date.now(), taskId);
    if (!cancelled) addAlert("task_failed", `「${row.name || `任务 #${taskId}`}」未完成：${(e as Error).message}`, undefined, `/tasks/${taskId}`);
  }
}

// 同时最多跑 2 个任务；请求速率由 TikHubClient 统一限制
const runSlots = new Semaphore(2);

export type CreateOpts = { competitorId?: number | null; name?: string; source?: "manual" | "schedule" | "rerun"; scheduleId?: number | null };

/** 创建任务并在后台执行（本地单进程）。线上改为入队。 */
export function createTask(cfg: TaskConfig, opts: CreateOpts = {}): number {
  const d = db();
  const info = d
    .prepare("INSERT INTO tasks(config, created_at, competitor_id, name, source, schedule_id, scope) VALUES (?,?,?,?,?,?,?)")
    .run(JSON.stringify(cfg), Date.now(), opts.competitorId ?? null, opts.name ?? null, opts.source ?? "manual", opts.scheduleId ?? null, "");
  const id = Number(info.lastInsertRowid);
  d.prepare("UPDATE tasks SET scope = ? WHERE id = ?").run(opts.competitorId ? `c${opts.competitorId}` : `t${id}`, id);
  void runSlots.run(() => runTask(id));
  return id;
}

export function cancelTask(id: number) {
  db().prepare("UPDATE tasks SET cancel = 1 WHERE id = ? AND status IN ('pending','running')").run(id);
}

export function budgetStatus() {
  return { used: tikhub().usedToday(), limit: configFromEnv().dailyBudget };
}
