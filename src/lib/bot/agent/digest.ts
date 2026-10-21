// 周报：每周固定时间向已订阅的会话推一份竞品投放动态；也可以随时问「这周的周报」。
// 卡片里的数字永远来自查询（模板生成）；大模型只负责在最上面加一段"要点解读"，失败/超额时周报照发，只是少这一段。
import { db } from "../../db";
import { overview } from "../../queries";
import { card, link, pct } from "../cards";
import type { Card, Sender } from "../types";
import { clean, spark } from "./data";
import { llmAnalyze, llmConfigured, type LlmDeps } from "./llm";

type Env = Record<string, string | undefined>;

/* ───────── 设置：库里的优先，其次环境变量 BOT_DIGEST（如 "mon@9" / "周五 17" / "off"） ───────── */
export type DigestCfg = { enabled: boolean; weekday: number; hour: number };
const KEY_CFG = "bot_digest", KEY_LAST = "bot_digest_last";
export const WEEKDAY_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

const getKV = (k: string) => (db().prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? null;
const setKV = (k: string, v: string) => db().prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

const WD: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
/** "周一" / "星期五" / "mon" / 数字 0-6 → 0-6；认不出返回 null。 */
export function parseWeekday(v: unknown): number | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/^(周|星期|礼拜)/, "");
  if (/^[0-6]$/.test(s)) return Number(s);
  return s in WD ? WD[s] : s.slice(0, 3) in WD ? WD[s.slice(0, 3)] : null;
}
export function parseHour(v: unknown): number | null {
  const m = /^(\d{1,2})(?:\s*[:点时]|$)/.exec(String(v ?? "").trim());
  return m && Number(m[1]) <= 23 ? Number(m[1]) : null;
}

export function getDigestCfg(env: Env = process.env): DigestCfg {
  const base: DigestCfg = { enabled: false, weekday: 1, hour: 9 };
  const e = (env.BOT_DIGEST ?? "").trim();
  if (e && e !== "off") {
    const [d, h] = e.split(/[@\s]+/);
    base.enabled = true;
    base.weekday = parseWeekday(d) ?? base.weekday;
    base.hour = parseHour(h) ?? base.hour;
  }
  const stored = getKV(KEY_CFG);
  if (stored) { try { return { ...base, ...JSON.parse(stored) }; } catch { /* 忽略损坏的值 */ } }
  return base;
}
export function setDigestCfg(patch: Partial<DigestCfg>, env: Env = process.env): DigestCfg {
  const next = { ...getDigestCfg(env), ...patch };
  setKV(KEY_CFG, JSON.stringify(next));
  return next;
}

/** ISO 周编号，用来保证"每周只发一次"。 */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  return `${y}-W${String(Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}

/** 到点（当天且已过设定小时）且本周还没发过。机器人当时没开的话，当天晚些时候开起来仍会补发。 */
export function digestDue(now: Date, cfg: DigestCfg, last: string | null): boolean {
  return cfg.enabled && now.getDay() === cfg.weekday && now.getHours() >= cfg.hour && last !== weekKey(now);
}

/* ───────── 内容 ───────── */
export function digestData() {
  const o = overview();
  return {
    totals: { competitors: o.totals.competitors, accounts: o.totals.accounts, repeat: o.totals.repeat, repeatRate: Math.round(o.totals.repeatRate * 100) / 100, newThisWeek: o.totals.newThisWeek },
    competitors: o.perCompetitor.map((c) => {
      const s = o.trend.series[`c${c.id}`] ?? [];
      return { name: c.name, accounts: c.accounts, repeat: c.repeat, repeatRate: Math.round(c.repeatRate * 100) / 100, newThisWeek: c.newThisWeek, postsThisWeek: s.at(-1) ?? 0, postsLastWeek: s.at(-2) ?? 0, last8: s.slice(-8) };
    }),
    newAccounts: o.newAccounts.slice(0, 5).map((a) => ({ name: clean(a.name), followers: a.followers, competitors: a.competitors.map((c) => c.name) })),
  };
}

const arrow = (now: number, prev: number) => (now > prev ? `↑${now - prev}` : now < prev ? `↓${prev - now}` : "持平");
const md = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

export function digestCard(baseUrl: string, analysis?: string, note?: string, now = new Date()): Card {
  const d = digestData();
  const lines = [
    ...(analysis ? [`📝 **要点**\n${analysis}`] : []),
    `**${d.totals.competitors}** 个竞品 · **${d.totals.accounts}** 个账号 · 高频复投 **${d.totals.repeat}**（${pct(d.totals.repeatRate)}）· 本周新增 **${d.totals.newThisWeek}**`,
    ...d.competitors.map((c) => `**${c.name}**　${spark(c.last8)}　本周作品 ${c.postsThisWeek}（较上周 ${arrow(c.postsThisWeek, c.postsLastWeek)}）· 新增账号 ${c.newThisWeek} · 复投 ${c.repeat}`),
    d.newAccounts.length ? "**新面孔**\n" + d.newAccounts.map((a) => `• ${a.name}${a.competitors.length ? `（${a.competitors.join("/")}）` : ""}`).join("\n") : "",
    link("打开控制台", `${baseUrl.replace(/\/$/, "")}/`),
  ];
  return card(`📊 竞品投放周报 · ${md(new Date(now.getTime() - 6 * 86_400_000))}–${md(now)}`, "violet", lines, { note });
}

/* ───────── 定时推送 ───────── */
/** 到点就向所有订阅会话发一次。返回是否发送。 */
export async function sendDigestOnce(sender: Sender, baseUrl: string, deps: LlmDeps = {}, now = new Date()): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (!digestDue(now, getDigestCfg(env), getKV(KEY_LAST))) return false;
  const chats = (db().prepare("SELECT chat_id FROM bot_subs").all() as Array<{ chat_id: string }>).map((r) => r.chat_id);
  if (!chats.length) return false; // 没人订阅：不标记已发，等有人订阅后当天仍会发
  setKV(KEY_LAST, weekKey(now)); // 先标记再发，避免两个进程同时到点重复推送

  let analysis: string | undefined, note: string | undefined;
  if (env.BOT_AGENT === "llm" && llmConfigured(env)) {
    const r = await llmAnalyze("请写本周竞品投放周报的要点", "本周整体变化、各竞品投放节奏的升降、值得关注的新面孔", [{ tool: "weekly_report", args: {}, data: digestData() }], { ...deps, env, userId: "system" });
    analysis = r.text; note = r.note;
  }
  const c = digestCard(baseUrl, analysis, note, now);
  for (const chat of chats) await sender.card(chat, c).catch((e) => console.error("[bot] digest", e));
  return true;
}

export function startDigest(sender: Sender, baseUrl: string, intervalMs = 5 * 60_000) {
  const timer = setInterval(() => sendDigestOnce(sender, baseUrl).catch((e) => console.error("[bot] digest", e)), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
