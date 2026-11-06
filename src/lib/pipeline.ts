import { estimateSearchPages } from "./search-pages";
import { db } from "./db";
import { classify } from "./classify";
import { PLATFORMS } from "./platforms";
import { countCallsToday, runtimeConfigFromEnv, BudgetExceededError, TikHubError } from "./tikhub/client";
import { CircuitOpenError, Semaphore } from "./tikhub/limiter";
import { getSettings } from "./settings";
import { addAlert } from "./alerts";
import type { NormPost, Progress, SearchPage, TaskConfig } from "./types";

const DAY = 86_400_000;

export function resolveRange(t: TaskConfig["time"], now = Date.now()): { from: number; to: number; days: number } {
  if (t.type === "relative") return { from: now - t.days * DAY, to: now, days: t.days };
  const from = new Date(`${t.from}T00:00:00+08:00`).getTime();
  const to = new Date(`${t.to}T23:59:59.999+08:00`).getTime();
  // 搜索接口只有"最近N天"档位，所以按距今天数取档
  return { from, to, days: Math.max(1, Math.ceil((now - from) / DAY)) };
}

/** 创建任务前估算 TikHub 调用量，用于预算确认。 */
export function estimateCalls(cfg: TaskConfig): number {
  const pages = cfg.maxPages ?? estimateSearchPages(cfg.platforms.length, cfg.keywords.length);
  const search = cfg.platforms.length * cfg.keywords.length * pages;
  // 需单独补粉丝数的平台：每个命中账号 1 次调用，粗估 = 每页约 12 个账号
  const accounts = Math.min(100, cfg.maxPosts ?? Infinity, cfg.keywords.length * pages * 12);
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
  const row = db().prepare("SELECT config, scope, name, source FROM tasks WHERE id = ?").get(taskId) as
    | { config: string; scope: string; name: string | null; source: string }
    | undefined;
  if (!row) throw new Error(`task ${taskId} 不存在`);
  const cfg = JSON.parse(row.config) as TaskConfig;
  const settings = getSettings();
  const range = resolveRange(cfg.time);
  const searchOptions = { ...range, refresh: row.source === "rerun" };
  const postsSeenByPlatform: NonNullable<Progress["postsSeenByPlatform"]> = {};
  const p: Progress = { stage: "searching", postsSeen: 0, postsSeenByPlatform, postsMatched: 0, calls: 0 };
  db().prepare("UPDATE tasks SET status='running', error=NULL WHERE id=?").run(taskId);
  const checkCancel = () => {
    const r = db().prepare("SELECT cancel FROM tasks WHERE id=?").get(taskId) as { cancel: number } | undefined;
    if (!r || r.cancel) throw new Cancelled("任务已取消");
  };

  try {
    const before = scopeCounts(row.scope);
    const d = db();
    const accounts = new Set<string>();
    const platformErrors: string[] = [];
    p.platformErrors = platformErrors;
    let pause: BudgetExceededError | CircuitOpenError | undefined;
    /** 只有共享预算或账号级熔断会停止整个任务的请求。 */
    async function whileRequestsAllowed<T>(request: () => Promise<T>): Promise<T | undefined> {
      if (pause) return undefined;
      try {
        return await request();
      } catch (error) {
        if (!(error instanceof BudgetExceededError || (error instanceof CircuitOpenError && error.fatal))) throw error;
        pause = error;
        return undefined;
      }
    }

    for (const platform of new Set(cfg.platforms)) {
      const adapter = PLATFORMS[platform];
      const hits = new Map<string, { post: NormPost; keywords: Set<string>; confidence: number; reasons: string[] }>();
      const previousMatches = p.postsMatched ?? 0;
      let platformCircuitOpen = false;
      let platformPostsSeen = 0;
      const scanToPostLimit = platform === "xiaohongshu" && cfg.maxPosts != null;
      p.stage = "searching";
      setProgress(taskId, p);

      search: for (const kw of new Set(cfg.keywords)) {
        let next: Record<string, string | number> | null = null;
        const cursors = new Set<string>();
        const seenPages = new Set<string>();
        for (let page = 0; cfg.maxPages == null || page < cfg.maxPages; page++) {
          checkCancel();
          let res: SearchPage | undefined;
          try {
            res = await whileRequestsAllowed(() => adapter.search(kw, range.days, next, taskId, searchOptions));
          } catch (error) {
            if (!(error instanceof TikHubError || error instanceof CircuitOpenError)) throw error;
            if (error instanceof TikHubError) p.calls = (p.calls ?? 0) + 1;
            const requestId = error.message.match(/"request_id"\s*:\s*"([\w-]+)"/)?.[1];
            const reason = error instanceof TikHubError && error.status
              ? `HTTP ${error.status}${requestId ? `，请求 ID ${requestId}` : ""}`
              : error.message;
            platformErrors.push(`${adapter.name}「${kw}」第 ${page + 1} 页搜索失败（${reason}）`);
            if (error instanceof CircuitOpenError) {
              platformCircuitOpen = true;
              break search;
            }
            break;
          }
          if (!res) break search;
          p.calls = (p.calls ?? 0) + 1;
          // 某些平台会换游标但仍返回同一批作品。
          if (res.posts.length) {
            const fingerprint = JSON.stringify(res.posts.map((post) => post.postId).sort());
            if (seenPages.has(fingerprint)) break;
            seenPages.add(fingerprint);
          }
          // 请求仍按平台的页大小发送，最后一页只检查剩余条数。
          const posts = cfg.maxPosts == null ? res.posts : res.posts.slice(0, cfg.maxPosts - platformPostsSeen);
          platformPostsSeen += posts.length;
          postsSeenByPlatform[platform] = platformPostsSeen;
          p.postsSeen = (p.postsSeen ?? 0) + posts.length;
          for (const post of posts) {
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
          p.postsMatched = previousMatches + hits.size;
          setProgress(taskId, p);
          if (cfg.maxPosts != null && platformPostsSeen >= cfg.maxPosts) break search;
          if (!res.hasMore) break;
          // 小红书跨页可能乱序，指定条数时继续扫描，发布时间仍逐条筛选。
          if (!scanToPostLimit && res.posts.length > 0 && res.posts.every((post) => post.publishedAt < range.from)) break;
          // 比较已使用的分页参数，拦住不前进或来回跳的游标。
          const entries = Object.entries(res.next).sort(([a], [b]) => a.localeCompare(b));
          const cursor = JSON.stringify(entries);
          if (!entries.length || cursors.has(cursor)) break;
          cursors.add(cursor);
          next = res.next;
        }
      }

      // 账号维度：换出真实账号 → 补粉丝数 → 粉丝/互动过滤 → 入库
      p.stage = "enriching";
      setProgress(taskId, p);
      // 搜索结果没有作者稳定 ID 的平台（视频号）：每个临时账号用一条命中作品换出真实账号。
      // 只对命中的账号做；失败（null）则沿用临时 ID，同一作者的作品仍聚在一起。
      /** 平台补资料失败时沿用搜索结果，避免丢掉已命中的作品。 */
      async function enrich<T>(phase: string, request: () => Promise<T>): Promise<T | undefined> {
        if (platformCircuitOpen) return undefined;
        try {
          return await whileRequestsAllowed(request);
        } catch (error) {
          if (!(error instanceof TikHubError || error instanceof CircuitOpenError)) throw error;
          platformCircuitOpen = true;
          platformErrors.push(`${adapter.name}${phase}失败（${error.message}）`);
          return undefined;
        }
      }

      const resolved = new Map<string, { uid: string; name?: string; url?: string } | null>();
      for (const { post } of hits.values()) {
        const resolve = PLATFORMS[post.platform].resolveAccount;
        const k = `${post.platform}:${post.accountUid}`;
        if (!resolve || resolved.has(k)) continue;
        checkCancel();
        const account = await enrich("识别账号", () => resolve(post, taskId));
        if (account === undefined) break;
        resolved.set(k, account);
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
          const count = await enrich("补充粉丝数", () => fn(k.slice(i + 1), taskId));
          if (count === undefined) break;
          followers.set(k, count);
          p.calls = (p.calls ?? 0) + 1;
        }
      }

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

      p.accounts = accounts.size;
      setProgress(taskId, p);
      if (pause) break;
    }

    // 相对该 scope 历史：新增账号 / 新晋复投
    const after = scopeCounts(row.scope);
    const n = Math.max(2, cfg.repeatThreshold ?? settings.repeatThreshold);
    p.newAccounts = [...accounts].filter((k) => !before.has(k)).length;
    p.newRepeat = [...accounts].filter((k) => (after.get(k) ?? 0) >= n && (before.get(k) ?? 0) < n).length;
    p.repeatAccounts = [...accounts].filter((k) => (after.get(k) ?? 0) >= n).length;
    p.stage = "done";
    p.accounts = accounts.size;
    const platformError = platformErrors.join("；");
    const taskError = [pause?.message, platformError].filter(Boolean).join("；") || null;
    if (taskError) p.note = taskError;
    const status = pause instanceof BudgetExceededError ? "paused_budget" : pause ? "paused_circuit" : platformError ? "failed" : "done";
    d.prepare("UPDATE tasks SET status=?, error=?, progress=?, finished_at=? WHERE id=?")
      .run(status, taskError, JSON.stringify(p), Date.now(), taskId);

    const label = row.name || `任务 #${taskId}`;
    if (taskError) {
      addAlert("task_failed", `「${label}」抓取未完成，已保存当前结果`, taskError, `/tasks/${taskId}`);
      return;
    }
    addAlert("task_done", `「${label}」抓取完成`, `命中 ${accounts.size} 个账号，其中新增 ${p.newAccounts} 个`, `/tasks/${taskId}`);
    if (p.newRepeat) addAlert("new_repeat", `「${label}」新增 ${p.newRepeat} 个高频复投账号`, "这些账号投放次数刚达到复投阈值", `/tasks/${taskId}`);
    const { used, limit } = budgetStatus();
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

/** 预算读自本地统计，密钥仅在准备发起抓取时检查。 */
export function budgetStatus() {
  return { used: countCallsToday(), limit: runtimeConfigFromEnv().dailyBudget, configured: !!process.env.TIKHUB_API_KEY?.trim() };
}
