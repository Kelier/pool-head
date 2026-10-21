// 读模型：账号聚合、总览、趋势、对比、任务/竞品列表、调用统计。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "./db";
import { frequencyLabel } from "./classify";
import { getSettings, tierOf, type Tier } from "./settings";

const all = (sql: string, ...args: any[]) => db().prepare(sql).all(...args) as any[];
const one = (sql: string, ...args: any[]) => db().prepare(sql).get(...args) as any;

/* ───────── 竞品 ───────── */
export type Competitor = { id: number; name: string; color: string; keywords: string[]; platforms: string[]; note: string | null; createdAt: number };
const compRow = (r: any): Competitor => ({
  id: r.id, name: r.name, color: r.color, keywords: JSON.parse(r.keywords), platforms: JSON.parse(r.platforms), note: r.note, createdAt: r.created_at,
});
export const listCompetitors = (): Competitor[] => all("SELECT * FROM competitors ORDER BY id").map(compRow);
export const getCompetitor = (id: number): Competitor | null => {
  const r = one("SELECT * FROM competitors WHERE id = ?", id);
  return r ? compRow(r) : null;
};

const PALETTE = ["#ff1eb4", "#579df8", "#2fd4a0", "#f5b83d", "#be6aff", "#ff7b71", "#1fc8c8", "#8fd14f"];
export function saveCompetitor(input: any, id?: number): number {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new Error("请填写竞品名称");
  const keywords = [...new Set<string>((input?.keywords ?? []).map((k: string) => String(k).trim()).filter(Boolean))];
  if (!keywords.length) throw new Error("请至少填写一个监测关键词");
  const platforms = (input?.platforms ?? []).filter(Boolean);
  if (!platforms.length) throw new Error("请至少选择一个平台");
  const d = db();
  if (id) {
    d.prepare("UPDATE competitors SET name=?, color=COALESCE(?, color), keywords=?, platforms=?, note=? WHERE id=?")
      .run(name, input?.color ?? null, JSON.stringify(keywords), JSON.stringify(platforms), input?.note ?? null, id);
    return id;
  }
  const n = (one("SELECT COUNT(*) c FROM competitors").c as number) ?? 0;
  const r = d.prepare("INSERT INTO competitors(name, color, keywords, platforms, note, created_at) VALUES (?,?,?,?,?,?)")
    .run(name, input?.color || PALETTE[n % PALETTE.length], JSON.stringify(keywords), JSON.stringify(platforms), input?.note ?? null, Date.now());
  return Number(r.lastInsertRowid);
}

export function deleteCompetitor(id: number) {
  const d = db();
  d.prepare("DELETE FROM promo_posts WHERE scope = ?").run(`c${id}`);
  d.prepare("DELETE FROM tasks WHERE competitor_id = ?").run(id);
  d.prepare("DELETE FROM schedules WHERE competitor_id = ?").run(id);
  d.prepare("DELETE FROM competitors WHERE id = ?").run(id);
}

/* ───────── 数据源（去重 + 剔除人工否决） ───────── */
export type Scope = { taskId?: number; scope?: string; competitorId?: number };

function source(s: Scope, opts: { rejected: boolean } = { rejected: false }): { sql: string; args: any[] } {
  const scope = s.scope ?? (s.competitorId ? `c${s.competitorId}` : undefined);
  let where: string;
  const args: any[] = [];
  if (s.taskId) {
    where = "p.task_id = ?";
    args.push(s.taskId);
  } else if (scope) {
    where = "p.rowid IN (SELECT MAX(rowid) FROM promo_posts WHERE scope = ? GROUP BY platform, post_id)";
    args.push(scope);
  } else {
    where = "p.rowid IN (SELECT MAX(rowid) FROM promo_posts GROUP BY platform, post_id, scope)";
  }
  const rej = opts.rejected
    ? ""
    : " AND NOT EXISTS (SELECT 1 FROM post_flags f WHERE f.platform = p.platform AND f.post_id = p.post_id AND f.verdict = 'rejected')";
  return { sql: `SELECT p.* FROM promo_posts p WHERE ${where}${rej}`, args };
}

/* ───────── 账号聚合 ───────── */
export type AccountFilter = Scope & {
  platform?: string; q?: string; tier?: Tier; status?: string; tag?: string;
  repeatOnly?: boolean; fMin?: number; fMax?: number; competitor?: number;
  sort?: "count" | "followers" | "last" | "first" | "likes" | "seen"; dir?: "asc" | "desc";
  page?: number; pageSize?: number; n?: number;
};

export type AccountRow = {
  platform: string; uid: string; name: string; profileUrl: string; followers: number | null; tier: Tier;
  promoCount: number; maxRepeat: number; label: string; isRepeat: boolean;
  firstAt: number; lastAt: number; avgLikes: number; avgComments: number;
  keywords: string[]; crawledAt: number; firstSeenAt: number;
  competitors: Array<{ id: number; name: string; color: string; count: number }>;
  status: string; tags: string[]; note: string;
};

export function accountRows(f: AccountFilter = {}): AccountRow[] {
  const st = getSettings();
  const n = f.n ?? st.repeatThreshold;
  const src = source(f);
  const rows = all(
    `SELECT p.platform, p.account_uid uid, p.scope, COUNT(*) cnt, MIN(p.published_at) first_at, MAX(p.published_at) last_at,
            SUM(p.likes) likes, SUM(p.comments) comments, MAX(p.crawled_at) crawled_at, MIN(p.crawled_at) seen_at
     FROM (${src.sql}) p GROUP BY p.platform, p.account_uid, p.scope`,
    ...src.args,
  );
  const kwRows = all(`SELECT p.platform, p.account_uid uid, p.keywords FROM (${src.sql}) p`, ...src.args);
  const kwMap = new Map<string, Set<string>>();
  for (const r of kwRows) {
    const k = `${r.platform}:${r.uid}`;
    const set = kwMap.get(k) ?? new Set<string>();
    (JSON.parse(r.keywords) as string[]).forEach((x) => set.add(x));
    kwMap.set(k, set);
  }
  const comps = new Map(listCompetitors().map((c) => [`c${c.id}`, c]));
  const accs = new Map(all("SELECT * FROM accounts").map((a) => [`${a.platform}:${a.uid}`, a]));
  const metas = new Map(all("SELECT * FROM account_meta").map((m) => [`${m.platform}:${m.uid}`, m]));

  type Acc = AccountRow & { _likes: number; _comments: number };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const k = `${r.platform}:${r.uid}`;
    const a = accs.get(k);
    const m = metas.get(k);
    let cur = map.get(k);
    if (!cur) {
      cur = {
        platform: r.platform, uid: r.uid, name: a?.name ?? r.uid, profileUrl: a?.profile_url ?? "", followers: a?.followers ?? null,
        tier: tierOf(a?.followers, st.tiers), promoCount: 0, maxRepeat: 0, label: "", isRepeat: false,
        firstAt: r.first_at, lastAt: r.last_at, avgLikes: 0, avgComments: 0, keywords: [...(kwMap.get(k) ?? [])],
        crawledAt: r.crawled_at, firstSeenAt: r.seen_at, competitors: [],
        status: m?.status ?? "none", tags: m ? JSON.parse(m.tags) : [], note: m?.note ?? "", _likes: 0, _comments: 0,
      };
      map.set(k, cur);
    }
    cur.promoCount += r.cnt;
    cur.maxRepeat = Math.max(cur.maxRepeat, r.cnt);
    cur.firstAt = Math.min(cur.firstAt, r.first_at);
    cur.lastAt = Math.max(cur.lastAt, r.last_at);
    cur.crawledAt = Math.max(cur.crawledAt, r.crawled_at);
    cur.firstSeenAt = Math.min(cur.firstSeenAt, r.seen_at);
    cur._likes += r.likes ?? 0;
    cur._comments += r.comments ?? 0;
    const c = comps.get(r.scope);
    if (c) cur.competitors.push({ id: c.id, name: c.name, color: c.color, count: r.cnt });
  }
  let out: AccountRow[] = [...map.values()].map(({ _likes, _comments, ...a }) => ({
    ...a,
    avgLikes: Math.round(_likes / a.promoCount),
    avgComments: Math.round(_comments / a.promoCount),
    label: frequencyLabel(a.maxRepeat),
    isRepeat: a.maxRepeat >= n,
  }));

  // 过滤
  const q = f.q?.trim().toLowerCase();
  out = out.filter((a) =>
    (!f.platform || a.platform === f.platform) &&
    (!f.tier || a.tier === f.tier) &&
    (!f.status || a.status === f.status) &&
    (!f.tag || a.tags.includes(f.tag)) &&
    (!f.repeatOnly || a.isRepeat) &&
    (!f.competitor || a.competitors.some((c) => c.id === f.competitor)) &&
    (f.fMin == null || (a.followers ?? -1) >= f.fMin) &&
    (f.fMax == null || (a.followers ?? Infinity) <= f.fMax) &&
    (!q || a.name.toLowerCase().includes(q) || a.uid.toLowerCase().includes(q) || a.note.toLowerCase().includes(q)),
  );

  // 排序
  const dir = f.dir === "asc" ? 1 : -1;
  const key: Record<string, (a: AccountRow) => number> = {
    count: (a) => a.maxRepeat * 1e6 + a.promoCount, followers: (a) => a.followers ?? -1, last: (a) => a.lastAt,
    first: (a) => a.firstAt, likes: (a) => a.avgLikes, seen: (a) => a.firstSeenAt,
  };
  const kf = key[f.sort ?? "count"] ?? key.count;
  out.sort((a, b) => (kf(a) - kf(b)) * dir || b.lastAt - a.lastAt);
  return out;
}

export function summarize(rows: AccountRow[]) {
  const tiers: Record<string, number> = { head: 0, waist: 0, tail: 0, micro: 0, unknown: 0 };
  const platforms: Record<string, number> = {};
  let repeat = 0, posts = 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  let newThisWeek = 0;
  for (const a of rows) {
    tiers[a.tier]++;
    platforms[a.platform] = (platforms[a.platform] ?? 0) + 1;
    if (a.isRepeat) repeat++;
    posts += a.promoCount;
    if (a.firstSeenAt >= weekAgo) newThisWeek++;
  }
  return { accounts: rows.length, repeat, posts, tiers, platforms, newThisWeek, repeatRate: rows.length ? repeat / rows.length : 0 };
}

export function listAccounts(f: AccountFilter = {}) {
  const rows = accountRows(f);
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 500);
  const page = Math.max(f.page ?? 1, 1);
  return { total: rows.length, summary: summarize(rows), rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize };
}

/* ───────── 账号详情 ───────── */
export function accountDetail(platform: string, uid: string) {
  const row = accountRows({}).find((a) => a.platform === platform && a.uid === uid);
  if (!row) return null;
  const src = source({}, { rejected: true });
  const comps = new Map(listCompetitors().map((c) => [`c${c.id}`, c]));
  const posts = all(
    `SELECT p.*, f.verdict FROM (${src.sql}) p LEFT JOIN post_flags f ON f.platform = p.platform AND f.post_id = p.post_id
     WHERE p.platform = ? AND p.account_uid = ? ORDER BY p.published_at DESC`,
    ...src.args, platform, uid,
  ).map((p) => ({
    postId: p.post_id, url: p.url, title: p.title, publishedAt: p.published_at, likes: p.likes, comments: p.comments, plays: p.plays,
    keywords: JSON.parse(p.keywords), confidence: p.confidence, reasons: p.reasons ? JSON.parse(p.reasons) : [],
    verdict: p.verdict ?? "auto", scope: p.scope, competitor: comps.get(p.scope) ? { id: comps.get(p.scope)!.id, name: comps.get(p.scope)!.name, color: comps.get(p.scope)!.color } : null,
  }));
  return { account: row, posts };
}

export function saveAccountMeta(platform: string, uid: string, patch: { status?: string; tags?: string[]; note?: string }) {
  const cur = one("SELECT * FROM account_meta WHERE platform=? AND uid=?", platform, uid);
  const status = patch.status ?? cur?.status ?? "none";
  if (!["none", "watch", "contacted", "excluded"].includes(status)) throw new Error("非法状态");
  const tags = (patch.tags ?? (cur ? JSON.parse(cur.tags) : [])).map((t: string) => String(t).trim()).filter(Boolean).slice(0, 10);
  const note = patch.note ?? cur?.note ?? "";
  db().prepare(
    `INSERT INTO account_meta(platform, uid, status, tags, note, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(platform, uid) DO UPDATE SET status=excluded.status, tags=excluded.tags, note=excluded.note, updated_at=excluded.updated_at`,
  ).run(platform, uid, status, JSON.stringify(tags), note, Date.now());
}

export function flagPost(platform: string, postId: string, verdict: "rejected" | "auto") {
  if (verdict === "auto") db().prepare("DELETE FROM post_flags WHERE platform=? AND post_id=?").run(platform, postId);
  else db().prepare("INSERT OR REPLACE INTO post_flags(platform, post_id, verdict, updated_at) VALUES (?,?,?,?)").run(platform, postId, verdict, Date.now());
}

/* ───────── 趋势 ───────── */
function weekStart(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 周一
  return d.getTime();
}

/** 近 N 周投放内容量（按作品发布时间），可按竞品分序列。 */
export function weeklyTrend(f: Scope = {}, weeks = 12) {
  const src = source(f);
  const rows = all(`SELECT p.scope, p.published_at t FROM (${src.sql}) p WHERE p.published_at >= ?`, ...src.args, Date.now() - weeks * 7 * 86_400_000);
  const starts: number[] = [];
  const cur = weekStart(Date.now());
  for (let i = weeks - 1; i >= 0; i--) starts.push(cur - i * 7 * 86_400_000);
  const series = new Map<string, number[]>();
  for (const r of rows) {
    const idx = starts.indexOf(weekStart(r.t));
    if (idx < 0) continue;
    const arr = series.get(r.scope) ?? new Array(weeks).fill(0);
    arr[idx]++;
    series.set(r.scope, arr);
  }
  return { weeks: starts, series: Object.fromEntries(series) as Record<string, number[]> };
}

/* ───────── 任务 ───────── */
const taskRow = (r: any) => {
  const prog = JSON.parse(r.progress || "{}");
  return {
    id: r.id, name: r.name, status: r.status, error: r.error, source: r.source, scope: r.scope, competitorId: r.competitor_id,
    competitorName: r.competitor_name ?? null, competitorColor: r.competitor_color ?? null, scheduleId: r.schedule_id,
    config: JSON.parse(r.config), progress: prog, createdAt: r.created_at, finishedAt: r.finished_at,
  };
};
const TASK_SELECT = `SELECT t.*, c.name competitor_name, c.color competitor_color FROM tasks t LEFT JOIN competitors c ON c.id = t.competitor_id`;

export function listTasks(f: { competitorId?: number; status?: string; q?: string; page?: number; pageSize?: number } = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (f.competitorId) (where.push("t.competitor_id = ?"), args.push(f.competitorId));
  if (f.status) (where.push("t.status = ?"), args.push(f.status));
  if (f.q) (where.push("(t.name LIKE ? OR t.config LIKE ?)"), args.push(`%${f.q}%`, `%${f.q}%`));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = one(`SELECT COUNT(*) c FROM tasks t ${w}`, ...args).c as number;
  const pageSize = Math.min(f.pageSize ?? 20, 100);
  const page = Math.max(f.page ?? 1, 1);
  const rows = all(`${TASK_SELECT} ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize).map(taskRow);
  return { total, rows, page, pageSize };
}

export function getTask(id: number) {
  const r = one(`${TASK_SELECT} WHERE t.id = ?`, id);
  return r ? taskRow(r) : null;
}

export function deleteTask(id: number) {
  db().prepare("DELETE FROM promo_posts WHERE task_id = ?").run(id);
  db().prepare("DELETE FROM api_calls WHERE task_id = ?").run(id);
  db().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/* ───────── 总览 ───────── */
export function overview() {
  const comps = listCompetitors();
  const everything = accountRows({});
  const weekAgo = Date.now() - 7 * 86_400_000;
  const perCompetitor = comps.map((c) => {
    const rows = accountRows({ competitorId: c.id });
    const s = summarize(rows);
    const lastTask = one("SELECT id, status, finished_at FROM tasks WHERE competitor_id = ? ORDER BY id DESC LIMIT 1", c.id);
    const sched = one("SELECT interval_days, enabled, next_run_at FROM schedules WHERE competitor_id = ? ORDER BY id DESC LIMIT 1", c.id);
    // 竞品自身字段（含 platforms 数组）优先；摘要里的平台分布改名 platformCounts，避免同名覆盖
    return { ...s, platformCounts: s.platforms, ...c, lastTask: lastTask ?? null, schedule: sched ?? null };
  });
  const trend = weeklyTrend({}, 12);
  const sum = summarize(everything);
  return {
    totals: { competitors: comps.length, ...sum, tasks: one("SELECT COUNT(*) c FROM tasks").c },
    perCompetitor,
    trend: { ...trend, competitors: comps.map((c) => ({ id: c.id, name: c.name, color: c.color, key: `c${c.id}` })) },
    newAccounts: everything.filter((a) => a.firstSeenAt >= weekAgo).sort((a, b) => b.firstSeenAt - a.firstSeenAt).slice(0, 8),
    topRepeat: everything.filter((a) => a.isRepeat).slice(0, 8),
    recentTasks: listTasks({ pageSize: 6 }).rows,
  };
}

/* ───────── 对比 ───────── */
const cardOf = (a: AccountRow) => ({
  platform: a.platform, uid: a.uid, name: a.name, profileUrl: a.profileUrl, followers: a.followers, tier: a.tier,
  count: a.promoCount, lastAt: a.lastAt,
});

/** 任务 A（旧）→ 任务 B（新）：新增 / 流失 / 持续 / 新晋复投。 */
export function compareTasks(aId: number, bId: number) {
  const ta = getTask(aId), tb = getTask(bId);
  if (!ta || !tb) throw new Error("任务不存在");
  const n = getSettings().repeatThreshold;
  const A = new Map(accountRows({ taskId: aId }).map((a) => [`${a.platform}:${a.uid}`, a]));
  const B = new Map(accountRows({ taskId: bId }).map((a) => [`${a.platform}:${a.uid}`, a]));
  const added = [...B].filter(([k]) => !A.has(k)).map(([, a]) => cardOf(a));
  const lost = [...A].filter(([k]) => !B.has(k)).map(([, a]) => cardOf(a));
  const kept = [...B].filter(([k]) => A.has(k)).map(([k, b]) => {
    const a = A.get(k)!;
    return { ...cardOf(b), before: a.promoCount, after: b.promoCount, delta: b.promoCount - a.promoCount, upgraded: a.promoCount < n && b.promoCount >= n };
  });
  const sa = summarize([...A.values()]), sb = summarize([...B.values()]);
  return {
    a: { id: ta.id, name: ta.name, createdAt: ta.createdAt, ...sa }, b: { id: tb.id, name: tb.name, createdAt: tb.createdAt, ...sb },
    added, lost, kept: kept.sort((x, y) => y.delta - x.delta), upgraded: kept.filter((k) => k.upgraded),
  };
}

/** 竞品之间：共同 KOL、独占账号、重合度。 */
export function compareCompetitors(ids: number[]) {
  const comps = ids.map((id) => getCompetitor(id)).filter(Boolean) as Competitor[];
  if (comps.length < 2) throw new Error("至少选择两个竞品");
  const sets = comps.map((c) => ({ c, rows: new Map(accountRows({ competitorId: c.id }).map((a) => [`${a.platform}:${a.uid}`, a])) }));
  const keys = new Set(sets.flatMap((s) => [...s.rows.keys()]));
  const shared: any[] = [];
  const exclusive: Record<number, number> = {};
  sets.forEach((s) => (exclusive[s.c.id] = 0));
  for (const k of keys) {
    const have = sets.filter((s) => s.rows.has(k));
    if (have.length >= 2) {
      const base = have[0].rows.get(k)!;
      shared.push({ ...cardOf(base), counts: Object.fromEntries(have.map((s) => [s.c.id, s.rows.get(k)!.promoCount])), total: have.reduce((t, s) => t + s.rows.get(k)!.promoCount, 0) });
    } else exclusive[have[0].c.id]++;
  }
  const matrix = sets.map((x) =>
    sets.map((y) => {
      const inter = [...x.rows.keys()].filter((k) => y.rows.has(k)).length;
      const union = new Set([...x.rows.keys(), ...y.rows.keys()]).size;
      return { inter, jaccard: union ? inter / union : 0 };
    }),
  );
  return {
    competitors: sets.map((s) => ({ id: s.c.id, name: s.c.name, color: s.c.color, exclusive: exclusive[s.c.id], ...summarize([...s.rows.values()]) })),
    matrix, shared: shared.sort((a, b) => b.total - a.total),
  };
}

/* ───────── 调用统计 ───────── */
export function usage() {
  const day = (t: number) => new Date(t).toLocaleDateString("sv-SE");
  const rows = all("SELECT ts, endpoint, status, ms, cached FROM api_calls WHERE ts >= ?", Date.now() - 14 * 86_400_000);
  const perDay = new Map<string, { real: number; cached: number; errors: number }>();
  const perEndpoint = new Map<string, { calls: number; cached: number; errors: number; ms: number }>();
  for (const r of rows) {
    const d = perDay.get(day(r.ts)) ?? { real: 0, cached: 0, errors: 0 };
    const e = perEndpoint.get(r.endpoint) ?? { calls: 0, cached: 0, errors: 0, ms: 0 };
    if (r.cached) (d.cached++, e.cached++);
    else {
      d.real++; e.calls++; e.ms += r.ms ?? 0;
      if (r.status >= 400 || r.status === 0) (d.errors++, e.errors++);
    }
    perDay.set(day(r.ts), d);
    perEndpoint.set(r.endpoint, e);
  }
  const days: Array<{ day: string; real: number; cached: number; errors: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const k = day(Date.now() - i * 86_400_000);
    days.push({ day: k, ...(perDay.get(k) ?? { real: 0, cached: 0, errors: 0 }) });
  }
  const real = rows.filter((r) => !r.cached).length, cached = rows.length - real;
  return {
    days,
    endpoints: [...perEndpoint].map(([endpoint, v]) => ({ endpoint, ...v, avgMs: v.calls ? Math.round(v.ms / v.calls) : 0 })).sort((a, b) => b.calls - a.calls),
    cacheHitRate: rows.length ? cached / rows.length : 0,
    real14d: real,
  };
}
