// 给"解读"阶段用的紧凑数据 + 少量没有对应固定指令的查询卡片（趋势、账号详情）。
// 数据全部来自 queries.ts，口径与网页一致。注意：这里的字符串里有抓取来的不可信文本（账号名、标题），
// 所以统一过 clean()——去控制字符 / 尖括号 / 反引号并截短——并且只会送进「无工具」的解读调用。
import { accountDetail, accountRows, compareCompetitors, getTask, listCompetitors, listTasks, overview, summarize, usage, weeklyTrend, type AccountRow } from "../../queries";
import { listAlerts } from "../../alerts";
import { budgetStatus } from "../../pipeline";
import { PLATFORMS } from "../../platforms";
import { TIER_LABEL } from "../../settings";
import type { Platform } from "../../types";
import { card, day, fmtN, trunc } from "../cards";
import { findCompetitor } from "../commands";
import type { BotCtx, Reply } from "../types";
import { llmUsageToday } from "./budget";

type Args = Record<string, unknown>;
export const clean = (v: unknown, n = 24) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>`]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const r2 = (x: number) => Math.round(x * 100) / 100;
const date = (t: number) => new Date(t).toLocaleDateString("sv-SE");
const WEEK = 7 * 86_400_000;

const slim = (a: AccountRow) => ({
  name: clean(a.name), platform: PLATFORMS[a.platform as Platform]?.name ?? a.platform, followers: a.followers, tier: TIER_LABEL[a.tier],
  repeatTimes: a.maxRepeat, posts: a.promoCount, competitors: a.competitors.map((c) => `${clean(c.name)}×${c.count}`), firstSeen: date(a.firstSeenAt),
});

type Comp = { id: number; name: string };
function comp(a: Args, key = "competitor"): { c?: Comp } | { error: string } {
  const q = str(a[key]);
  if (!q) return {};
  const f = findCompetitor(q);
  return "error" in f ? { error: f.error } : { c: { id: f.c.id, name: f.c.name } };
}

/* ───────── 解读用数据 ───────── */
export function dataOverview() {
  const o = overview();
  return {
    totals: { competitors: o.totals.competitors, accounts: o.totals.accounts, repeat: o.totals.repeat, repeatRate: r2(o.totals.repeatRate), posts: o.totals.posts, newThisWeek: o.totals.newThisWeek },
    competitors: o.perCompetitor.map((c) => ({
      name: c.name, accounts: c.accounts, repeat: c.repeat, repeatRate: r2(c.repeatRate), posts: c.posts, newThisWeek: c.newThisWeek,
      tiers: c.tiers, postsPerWeekLast4: (o.trend.series[`c${c.id}`] ?? []).slice(-4),
    })),
  };
}

export function dataCompetitor(a: Args) {
  const r = comp(a);
  if ("error" in r) return r;
  if (!r.c) return { error: "缺少竞品名" };
  const rows = accountRows({ competitorId: r.c.id });
  const s = summarize(rows);
  const c = listCompetitors().find((x) => x.id === r.c!.id)!;
  return {
    name: c.name, keywords: c.keywords.map((k) => clean(k)), platforms: c.platforms,
    accounts: s.accounts, repeat: s.repeat, repeatRate: r2(s.repeatRate), posts: s.posts, newThisWeek: s.newThisWeek, tiers: s.tiers,
    postsPerWeekLast8: weeklyTrend({ competitorId: r.c.id }, 8).series[`c${r.c.id}`] ?? [],
    topRepeat: rows.filter((x) => x.isRepeat).slice(0, 5).map(slim),
  };
}

export function dataAccounts(kind: "repeat" | "new" | "search", a: Args) {
  const r = kind === "search" ? {} : comp(a);
  if ("error" in r) return r;
  let rows: AccountRow[];
  if (kind === "search") rows = accountRows({ q: str(a.keyword) });
  else if (kind === "repeat") rows = accountRows({ competitorId: r.c?.id, repeatOnly: true });
  else rows = accountRows({ competitorId: r.c?.id, sort: "seen" }).filter((x) => x.firstSeenAt >= Date.now() - WEEK);
  return { scope: r.c?.name ?? "全部竞品", total: rows.length, top: rows.slice(0, 10).map(slim) };
}

export function dataCompare(a: Args) {
  const x = comp(a, "competitor_a"), y = comp(a, "competitor_b");
  if ("error" in x) return x;
  if ("error" in y) return y;
  if (!x.c || !y.c) return { error: "需要两个竞品" };
  const r = compareCompetitors([x.c.id, y.c.id]);
  const names = new Map(r.competitors.map((c) => [c.id, c.name]));
  return {
    competitors: r.competitors.map((c) => ({ name: c.name, accounts: c.accounts, exclusive: c.exclusive, repeat: c.repeat })),
    sharedTotal: r.shared.length,
    jaccard: r2(r.matrix[0][1].jaccard),
    shared: r.shared.slice(0, 8).map((s: { name: string; followers: number | null; counts: Record<number, number> }) => ({
      name: clean(s.name), followers: s.followers, counts: Object.entries(s.counts).map(([id, n]) => `${names.get(Number(id))}×${n}`),
    })),
  };
}

export function dataTasks(a: Args) {
  const id = /^\d{1,9}$/.test(str(a.task_id)) ? Number(a.task_id) : 0;
  if (id) {
    const t = getTask(id);
    return t ? { id: t.id, name: clean(t.name), status: t.status, error: clean(t.error, 80), progress: t.progress } : { error: `没有任务 #${id}` };
  }
  return { recent: listTasks({ pageSize: 6 }).rows.map((t) => ({ id: t.id, name: clean(t.name), status: t.status })) };
}

export function dataUsage() {
  const b = budgetStatus(), u = usage(), l = llmUsageToday();
  return { tikhubToday: { used: b.used, limit: b.limit }, real14d: u.real14d, cacheHitRate: r2(u.cacheHitRate), llmToday: { calls: l.calls, tokensIn: l.tokensIn, tokensOut: l.tokensOut } };
}

export function dataAlerts() {
  return { items: (listAlerts(6).items as Array<{ title: string; body: string | null; ts: number }>).map((x) => ({ date: date(x.ts), title: clean(x.title, 60), body: clean(x.body, 80) })) };
}

export function dataTrend(a: Args) {
  const r = comp(a);
  if ("error" in r) return r;
  const weeks = Math.min(Math.max(Math.round(Number(a.weeks)) || 8, 4), 12);
  const t = weeklyTrend({}, weeks);
  const list = (r.c ? [r.c] : listCompetitors()).map((c) => ({ name: c.name, postsPerWeek: t.series[`c${c.id}`] ?? new Array(weeks).fill(0) }));
  return { weeks, note: "每周命中的投放作品数，最后一项是本周（未满一周）", competitors: list };
}

/** 账号：优先名称完全一致，其次第一个匹配。 */
function pickAccount(keyword: string) {
  const rows = accountRows({ q: keyword });
  return rows.find((x) => x.name === keyword) ?? rows[0] ?? null;
}

export function dataAccountDetail(a: Args) {
  const acc = pickAccount(str(a.keyword));
  if (!acc) return { error: `没有找到包含「${str(a.keyword)}」的账号。` };
  const d = accountDetail(acc.platform, acc.uid);
  return {
    account: slim(acc), note: clean(acc.note, 80), tags: acc.tags.map((t) => clean(t, 12)),
    posts: (d?.posts ?? []).slice(0, 8).map((p) => ({ title: clean(p.title, 40), date: date(p.publishedAt), likes: p.likes, comments: p.comments, plays: p.plays, competitor: p.competitor?.name })),
  };
}

/* ───────── 没有对应固定指令的查询：直接出卡片 ───────── */
const SPARK = "▁▂▃▄▅▆▇█";
export const spark = (v: number[]) => { const m = Math.max(...v, 1); return v.map((x) => SPARK[Math.min(7, Math.floor((x / m) * 7.999))]).join(""); };

export async function trendCard(a: Args, ctx: BotCtx): Promise<Reply> {
  const d = dataTrend(a);
  if ("error" in d) return { text: d.error as string };
  const lines = d.competitors.map((c) => `**${c.name}**　${spark(c.postsPerWeek)}　近 4 周：${c.postsPerWeek.slice(-4).join(" → ")}`);
  if (!lines.length) return { text: "还没有竞品。请先在控制台「竞品」里创建。" };
  return { card: card(`投放趋势 · 近 ${d.weeks} 周`, "turquoise", lines, { note: "每周命中的投放作品数，最后一项为本周（未满一周）", links: [{ text: "控制台趋势", url: `${ctx.baseUrl.replace(/\/$/, "")}/` }] }) };
}

export async function accountDetailCard(a: Args, ctx: BotCtx): Promise<Reply> {
  const acc = pickAccount(str(a.keyword));
  if (!acc) return { text: `没有找到包含「${str(a.keyword)}」的账号。` };
  const d = accountDetail(acc.platform, acc.uid);
  const posts = (d?.posts ?? []).slice(0, 5);
  return {
    card: card(`账号 · ${trunc(acc.name)}`, "blue", [
      `${PLATFORMS[acc.platform as Platform]?.name ?? acc.platform} · ${fmtN(acc.followers)}粉 · ${TIER_LABEL[acc.tier]} · 投放 **${acc.maxRepeat}** 次${acc.isRepeat ? " 🔥" : ""}`,
      `投放过：${acc.competitors.map((c) => `${c.name}×${c.count}`).join("、") || "—"}`,
      posts.length ? "**相关作品**\n" + posts.map((p) => `• ${trunc(p.title || "（无标题）", 30)}　${day(p.publishedAt)}　赞 ${fmtN(p.likes)} · 播放 ${fmtN(p.plays)}`).join("\n") : "",
    ], { note: posts.length ? `共 ${d?.posts.length} 条作品` : undefined, links: [{ text: "在控制台查看", url: `${ctx.baseUrl.replace(/\/$/, "")}/accounts?q=${encodeURIComponent(acc.name)}` }] }),
  };
}
