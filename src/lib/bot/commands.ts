// 指令层：把 Web 控制台的核心能力映射成"一句话"指令。只读现有 queries / export，不复制业务逻辑。
import { accountRows, compareCompetitors, getTask, listCompetitors, listTasks, overview, summarize, usage, type AccountRow, type Competitor } from "../queries";
import { listAlerts } from "../alerts";
import { buildSheets, renderXlsx } from "../export";
import { budgetStatus } from "../pipeline";
import { db } from "../db";
import { TIER_LABEL } from "../settings";
import { PLATFORMS } from "../platforms";
import type { Platform } from "../types";
import { card, day, fmtN, link, MAX_LIST, pct, trunc } from "./cards";
import { watchTask } from "./watch";
import type { BotCtx, Command, Reply } from "./types";

const TASK_STATUS: Record<string, string> = {
  pending: "排队中", running: "抓取中", done: "已完成", failed: "失败", cancelled: "已取消", paused_budget: "预算用尽", paused_circuit: "已熔断", interrupted: "已中断",
};

/** 去掉飞书 @ 占位符（@_user_1）与多余空白。 */
export const cleanText = (text: string) => text.replace(/@_user_\d+/g, " ").replace(/<at[^>]*>.*?<\/at>/g, " ").replace(/\s+/g, " ").trim();

export function parseCommand(text: string): { name: string; args: string[] } | null {
  const t = cleanText(text);
  if (!t) return null;
  const [name, ...args] = t.replace(/^\/+/, "").split(" ");
  return { name: name.toLowerCase(), args };
}

/** 支持「近30天 / 30天 / 30 / 一周 / 一月 / 半年」。 */
export function parseDays(arg?: string): number | null {
  if (!arg) return null;
  const m = /^近?(\d{1,3})天?$/.exec(arg);
  if (m) return Math.min(Math.max(+m[1], 1), 365);
  return ({ 一周: 7, 近一周: 7, 一月: 30, 近一月: 30, 一个月: 30, 半年: 180, 近半年: 180 } as Record<string, number>)[arg] ?? null;
}

type Found = { c: Competitor } | { error: string };
export function findCompetitor(q: string): Found {
  const all = listCompetitors();
  const lo = q.toLowerCase();
  const exact = all.filter((c) => c.name.toLowerCase() === lo);
  if (exact.length === 1) return { c: exact[0] };
  const part = all.filter((c) => c.name.toLowerCase().includes(lo));
  if (part.length === 1) return { c: part[0] };
  if (!part.length) return { error: `找不到竞品「${q}」。现有竞品：${all.map((c) => c.name).join("、") || "暂无（请先在控制台创建）"}` };
  return { error: `「${q}」匹配到多个竞品：${part.map((c) => c.name).join("、")}，请写全名` };
}

const accLine = (a: AccountRow, i: number) =>
  `${i + 1}. **${trunc(a.name)}**　${PLATFORMS[a.platform as Platform]?.name ?? a.platform} · ${fmtN(a.followers)}粉 · ${TIER_LABEL[a.tier]} · 投放 **${a.maxRepeat}** 次${a.isRepeat ? " 🔥" : ""}`;
const url = (ctx: BotCtx, path: string) => `${ctx.baseUrl.replace(/\/$/, "")}${path}`;

const COMMANDS: Command[] = [
  {
    names: ["帮助", "help", "?", "菜单"], usage: "帮助", desc: "查看可用指令", role: "member",
    run: async (_a, ctx) => ({
      card: card("投放监测机器人", "violet", [
        "直接发送（群里请 @我）：",
        ...COMMANDS.filter((c) => ctx.role === "admin" || c.role === "member").map((c) => `**${c.usage}**　${c.desc}`),
      ], { note: ctx.role === "admin" ? "你是管理员：可发起抓取" : "你是成员：只读查询与导出" }),
    }),
  },
  {
    names: ["总览", "overview"], usage: "总览", desc: "各竞品的账号数、复投数与本周新增", role: "member",
    run: async (_a, ctx) => {
      const o = overview();
      if (!o.perCompetitor.length) return { text: "还没有竞品。请先在控制台「竞品」里创建。" };
      return {
        card: card("投放监测 · 总览", "violet", [
          `**${o.totals.competitors}** 个竞品 · **${o.totals.accounts}** 个投放账号 · **${o.totals.repeat}** 个高频复投（${pct(o.totals.repeatRate)}）· 本周新增 **${o.totals.newThisWeek}**`,
          ...o.perCompetitor.slice(0, MAX_LIST).map((c) => `**${c.name}**　账号 ${c.accounts} · 复投 ${c.repeat}（${pct(c.repeatRate)}）· 作品 ${c.posts}`),
        ], { links: [{ text: "打开控制台", url: url(ctx, "/") }] }),
      };
    },
  },
  {
    names: ["竞品", "competitor"], usage: "竞品 [名称]", desc: "竞品列表，或某个竞品的详情", role: "member",
    run: async (args, ctx) => {
      if (!args.length) {
        const list = overview().perCompetitor;
        if (!list.length) return { text: "还没有竞品。请先在控制台「竞品」里创建。" };
        return { card: card("竞品列表", "blue", list.map((c) => `**${c.name}**　${c.keywords.slice(0, 3).join("、")}　账号 ${c.accounts} · 复投 ${c.repeat}`), { note: "发送「竞品 名称」查看详情" }) };
      }
      const f = findCompetitor(args.join(" "));
      if ("error" in f) return { text: f.error };
      const rows = accountRows({ competitorId: f.c.id });
      const s = summarize(rows);
      const sched = db().prepare("SELECT interval_days, enabled FROM schedules WHERE competitor_id = ? ORDER BY id DESC LIMIT 1").get(f.c.id) as { interval_days: number; enabled: number } | undefined;
      const last = listTasks({ competitorId: f.c.id, pageSize: 1 }).rows[0];
      return {
        card: card(`${f.c.name} · 详情`, "blue", [
          `监测词：${f.c.keywords.join("、")}　平台：${f.c.platforms.map((p) => PLATFORMS[p as Platform]?.name ?? p).join("/")}`,
          `账号 **${s.accounts}** · 高频复投 **${s.repeat}**（${pct(s.repeatRate)}）· 作品 **${s.posts}** · 本周新增 **${s.newThisWeek}**`,
          `层级：头部 ${s.tiers.head} / 腰部 ${s.tiers.waist} / 尾部 ${s.tiers.tail} / 素人 ${s.tiers.micro}`,
          `最近抓取：${last ? `${TASK_STATUS[last.status] ?? last.status}（#${last.id}）` : "尚未抓取"}　定时监控：${sched?.enabled ? `每 ${sched.interval_days} 天` : "未开启"}`,
          rows.length ? "**复投 Top**\n" + rows.filter((a) => a.isRepeat).slice(0, 5).map(accLine).join("\n") : "",
        ], { links: [{ text: "控制台详情", url: url(ctx, `/competitors/${f.c.id}`) }] }),
      };
    },
  },
  {
    names: ["抓取", "run", "crawl"], usage: "抓取 竞品名 [近30天]", desc: "发起一次抓取（会消耗 TikHub 调用）", role: "admin",
    run: async (args, ctx) => {
      if (!args.length) return { text: "用法：抓取 竞品名 [近30天]" };
      const days = parseDays(args[args.length - 1]);
      const name = (days ? args.slice(0, -1) : args).join(" ");
      const f = findCompetitor(name);
      if ("error" in f) return { text: f.error };
      const r = await ctx.backend.runCompetitor(f.c.id, days ?? 30);
      watchTask(r.id, ctx.chatId, ctx.sender, ctx.baseUrl);
      return { text: `已发起「${f.c.name}」抓取（任务 #${r.id}，近 ${days ?? 30} 天，预估约 ${r.estimate} 次调用）。完成后我会在这里通知你。` };
    },
  },
  {
    names: ["任务", "task", "tasks"], usage: "任务 [编号]", desc: "最近任务，或某个任务的状态", role: "member",
    run: async (args, ctx) => {
      const id = Number(args[0]);
      if (!args.length || !id) {
        const rows = listTasks({ pageSize: 6 }).rows;
        if (!rows.length) return { text: "还没有任务。" };
        return { card: card("最近任务", "blue", rows.map((t) => `**#${t.id}** ${t.name ?? "任务"}　${TASK_STATUS[t.status] ?? t.status}　${t.progress.accounts != null ? `账号 ${t.progress.accounts}` : ""}`), { links: [{ text: "全部任务", url: url(ctx, "/tasks") }] }) };
      }
      const t = getTask(id);
      if (!t) return { text: `没有任务 #${id}` };
      const p = t.progress;
      return {
        card: card(`任务 #${t.id} · ${t.name ?? ""}`, t.status === "done" ? "green" : t.status === "failed" ? "red" : "blue", [
          `状态：**${TASK_STATUS[t.status] ?? t.status}**${t.error ? `\n原因：${t.error}` : ""}`,
          `浏览 ${p.postsSeen ?? 0} 条 · 命中 ${p.postsMatched ?? 0} 条 · 账号 ${p.accounts ?? 0}（新增 ${p.newAccounts ?? 0}，复投 ${p.repeatAccounts ?? 0}）· 调用 ${p.calls ?? 0} 次`,
        ], { links: [{ text: "查看详情", url: url(ctx, `/tasks/${t.id}`) }] }),
      };
    },
  },
  {
    names: ["复投", "repeat"], usage: "复投 [竞品名]", desc: "高频复投账号 Top", role: "member",
    run: async (args, ctx) => {
      let competitorId: number | undefined;
      let title = "高频复投账号";
      if (args.length) {
        const f = findCompetitor(args.join(" "));
        if ("error" in f) return { text: f.error };
        competitorId = f.c.id;
        title = `${f.c.name} · 高频复投`;
      }
      const rows = accountRows({ competitorId, repeatOnly: true });
      if (!rows.length) return { text: "暂无达到复投阈值的账号。" };
      return { card: card(title, "orange", [rows.slice(0, MAX_LIST).map(accLine).join("\n")], { note: `共 ${rows.length} 个`, links: [{ text: "账号库", url: url(ctx, "/accounts?repeat=1") }] }) };
    },
  },
  {
    names: ["新增", "new"], usage: "新增 [竞品名]", desc: "近 7 天首次发现的账号", role: "member",
    run: async (args, ctx) => {
      let competitorId: number | undefined;
      if (args.length) {
        const f = findCompetitor(args.join(" "));
        if ("error" in f) return { text: f.error };
        competitorId = f.c.id;
      }
      const weekAgo = Date.now() - 7 * 86_400_000;
      const rows = accountRows({ competitorId, sort: "seen" }).filter((a) => a.firstSeenAt >= weekAgo);
      if (!rows.length) return { text: "近 7 天没有新增账号。" };
      return { card: card("本周新增账号", "green", [rows.slice(0, MAX_LIST).map(accLine).join("\n")], { note: `共 ${rows.length} 个`, links: [{ text: "账号库", url: url(ctx, "/accounts?sort=seen") }] }) };
    },
  },
  {
    names: ["账号", "account", "搜索"], usage: "账号 关键词", desc: "按名称/备注搜索账号", role: "member",
    run: async (args, ctx) => {
      if (!args.length) return { text: "用法：账号 关键词" };
      const rows = accountRows({ q: args.join(" ") });
      if (!rows.length) return { text: `没有找到包含「${args.join(" ")}」的账号。` };
      return { card: card(`账号搜索：${args.join(" ")}`, "blue", [rows.slice(0, MAX_LIST).map(accLine).join("\n")], { note: `共 ${rows.length} 个`, links: [{ text: "在控制台查看", url: url(ctx, `/accounts?q=${encodeURIComponent(args.join(" "))}`) }] }) };
    },
  },
  {
    names: ["对比", "compare"], usage: "对比 竞品A 竞品B", desc: "两个竞品的共同 KOL", role: "member",
    run: async (args, ctx) => {
      if (args.length < 2) return { text: "用法：对比 竞品A 竞品B（名称不含空格）" };
      const found = args.map(findCompetitor);
      const err = found.find((f) => "error" in f) as { error: string } | undefined;
      if (err) return { text: err.error };
      const comps = (found as Array<{ c: Competitor }>).map((f) => f.c);
      const r = compareCompetitors(comps.map((c) => c.id));
      return {
        card: card(`${comps.map((c) => c.name).join(" vs ")} · 共同 KOL`, "purple", [
          r.competitors.map((c) => `**${c.name}**　账号 ${c.accounts} · 独占 ${c.exclusive} · 复投 ${c.repeat}`).join("\n"),
          r.shared.length ? "**共同账号**\n" + r.shared.slice(0, MAX_LIST).map((s, i) => `${i + 1}. **${trunc(s.name)}** ${fmtN(s.followers)}粉　` + comps.map((c) => `${c.name}×${s.counts[c.id] ?? 0}`).join(" ")).join("\n") : "没有共同账号。",
        ], { note: `共 ${r.shared.length} 个共同账号`, links: [{ text: "对比分析", url: url(ctx, "/compare") }] }),
      };
    },
  },
  {
    names: ["导出", "export"], usage: "导出 账号|报告 竞品名", desc: "发送 Excel 文件", role: "member",
    run: async (args) => {
      const kind = args[0];
      if (!["账号", "报告"].includes(kind) || args.length < 2) return { text: "用法：导出 账号 竞品名　或　导出 报告 竞品名" };
      const f = findCompetitor(args.slice(1).join(" "));
      if ("error" in f) return { text: f.error };
      const sp = new URLSearchParams(kind === "账号" ? { competitorScope: String(f.c.id) } : { id: String(f.c.id) });
      const built = buildSheets(kind === "账号" ? "accounts" : "report", sp);
      return { file: { name: `${built.filename}.xlsx`, data: await renderXlsx(built) }, text: undefined };
    },
  },
  {
    names: ["用量", "预算", "usage"], usage: "用量", desc: "今日 API 调用与预算", role: "member",
    run: async (_a, ctx) => {
      const b = budgetStatus();
      const u = usage();
      return { card: card("API 用量", "grey", [`今日已调用 **${b.used}** / ${b.limit}（${pct(b.used / b.limit)}）`, `近 14 天真实调用 ${u.real14d} 次 · 缓存命中率 ${pct(u.cacheHitRate)}`], { links: [{ text: "调用监控", url: url(ctx, "/settings?tab=usage") }] }) };
    },
  },
  {
    names: ["提醒", "alerts"], usage: "提醒", desc: "最近的系统提醒", role: "member",
    run: async () => {
      const a = listAlerts(6).items as Array<{ title: string; body: string | null; ts: number }>;
      if (!a.length) return { text: "暂无提醒。" };
      return { card: card("最近提醒", "yellow", a.map((x) => `${day(x.ts)}　**${x.title}**${x.body ? `\n${x.body}` : ""}`)) };
    },
  },
  {
    names: ["订阅", "subscribe"], usage: "订阅", desc: "把本会话加入提醒推送（新增复投、任务完成、预算告警）", role: "admin",
    run: async (_a, ctx) => {
      db().prepare("INSERT OR IGNORE INTO bot_subs(chat_id, created_at) VALUES (?, ?)").run(ctx.chatId, Date.now());
      return { text: "已订阅：新的系统提醒会推送到这个会话。发送「退订」取消。" };
    },
  },
  {
    names: ["退订", "unsubscribe"], usage: "退订", desc: "取消本会话的提醒推送", role: "admin",
    run: async (_a, ctx) => {
      db().prepare("DELETE FROM bot_subs WHERE chat_id = ?").run(ctx.chatId);
      return { text: "已退订。" };
    },
  },
];

export const ALL_COMMANDS = COMMANDS;

/**
 * 预留：自然语言入口。默认不启用；配置后可把「帮我看看 libtv 最近有没有新账号」解析成 { name, args }。
 * 典型实现是调用 LLM 做意图分类，再回到下面的 dispatch，权限与限流不变。
 */
export type IntentResolver = (text: string, ctx: BotCtx) => Promise<{ name: string; args: string[] } | null>;

export const findCommand = (name: string) => COMMANDS.find((c) => c.names.includes(name.toLowerCase()));

/** 直接按名称+参数执行指令（含角色校验）。文本指令与意图层共用同一入口，权限判断只此一处。 */
export async function runCommand(name: string, args: string[], ctx: BotCtx): Promise<Reply> {
  const cmd = findCommand(name);
  if (!cmd) return { text: `没有「${trunc(name, 12)}」这个指令。` };
  if (cmd.role === "admin" && ctx.role !== "admin") return { text: `「${cmd.names[0]}」仅管理员可用（它会消耗 TikHub 调用）。` };
  return cmd.run(args, ctx);
}

export async function dispatch(text: string, ctx: BotCtx, resolve?: IntentResolver): Promise<Reply> {
  let parsed = parseCommand(text);
  if (!parsed) return { text: "发送「帮助」查看可用指令。" };
  let cmd = COMMANDS.find((c) => c.names.includes(parsed!.name));
  if (!cmd && resolve) {
    const r = await resolve(text, ctx);
    if (r) { parsed = r; cmd = COMMANDS.find((c) => c.names.includes(r.name)); }
  }
  if (!cmd) return { text: `没听懂「${trunc(parsed.name, 12)}」。发送「帮助」查看可用指令。` };
  return runCommand(cmd.names[0], parsed.args, ctx);
}

export { link };
