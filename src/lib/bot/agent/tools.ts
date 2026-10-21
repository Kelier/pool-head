// 工具注册表：声明一次（名称/描述/JSON Schema/角色/怎么执行），规则解析与大模型共用。
// 后续要暴露成 MCP 服务或接入别的 Agent 网关，只需把这张表转一下格式。
//
// 三类工具：
//   · 查询  —— toCommand（复用固定指令出卡片）或 run（直接出卡片）；可带 data，供"解读"阶段使用
//   · 修改  —— propose 只生成待确认提议（落库），用户回复「确认」后才 execute；永远不会在模型调用里直接生效
//   · 设置  —— role=admin 且立即生效但无计费、可逆的开关（周报、订阅）
import { accountRows, getCompetitor, listCompetitors, saveAccountMeta, saveCompetitor } from "../../queries";
import { estimateCalls } from "../../pipeline";
import { configForCompetitor } from "../../scheduler";
import { PLATFORMS, PLATFORM_IDS } from "../../platforms";
import type { Platform } from "../../types";
import { db } from "../../db";
import { findCompetitor } from "../commands";
import { watchTask } from "../watch";
import type { BotCtx, Reply } from "../types";
import {
  accountDetailCard, dataAccountDetail, dataAccounts, dataAlerts, dataCompare, dataCompetitor, dataOverview, dataTasks, dataTrend, dataUsage, trendCard,
} from "./data";
import { WEEKDAY_LABEL, digestCard, digestData, getDigestCfg, parseHour, parseWeekday, setDigestCfg } from "./digest";

export type JsonSchema = { type: "object"; properties: Record<string, { type: string; description: string; enum?: string[] }>; required?: string[] };
type Args = Record<string, unknown>;

export type ToolDef = {
  name: string;
  /** 展示给用户的中文名（"理解为：趋势 LibTV"） */
  label: string;
  description: string;
  /** 需要的最低角色 */
  role: "member" | "admin";
  /** 会消耗 TikHub 调用：意图层触发时必须经过二次确认 */
  billed?: boolean;
  schema: JsonSchema;
  /** 参数 → 现有指令（名称 + 参数）。参数非法时返回 error（会原样回给用户，不会执行） */
  toCommand?: (args: Args) => { name: string; args: string[] } | { error: string };
  /** 没有对应固定指令的查询/设置：直接产出回复 */
  run?: (args: Args, ctx: BotCtx) => Promise<Reply>;
  /** 给"解读"阶段的紧凑结构化数据；返回含 error 的对象表示无数据，会被跳过 */
  data?: (args: Args, ctx: BotCtx) => unknown;
  /** 用户没明说也默认做一次解读（如周报） */
  analyzeByDefault?: boolean;
  /** 修改类：只"提议"。返回摘要与要落库的载荷，或 error（原样回给用户） */
  propose?: (args: Args, ctx: BotCtx) => { summary: string; payload: Args } | { error: string };
  /** 修改类：用户确认后执行。权限在此刻重新校验 */
  execute?: (payload: Args, ctx: BotCtx) => Promise<Reply>;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const need = (v: unknown, label: string) => (str(v) ? null : `缺少${label}`);
const comp = { type: "string", description: "竞品名称，必须是竞品名单里的名字" };
/** "a, b，c、d" → ["a","b","c","d"]，去重、限长、限个数 */
const list = (v: unknown, max = 10) => [...new Set(String(v ?? "").split(/[,，、;；\n]+/).map((s) => s.trim().slice(0, 30)).filter(Boolean))].slice(0, max);

const PLATFORM_ALIAS: Record<string, Platform> = { 抖音: "douyin", douyin: "douyin", 小红书: "xiaohongshu", xhs: "xiaohongshu", xiaohongshu: "xiaohongshu", 快手: "kuaishou", kuaishou: "kuaishou", b站: "bilibili", 哔哩哔哩: "bilibili", bilibili: "bilibili" };
function parsePlatforms(v: unknown): Platform[] | { error: string } {
  const out: Platform[] = [];
  for (const w of list(v, 4)) {
    const p = PLATFORM_ALIAS[w.toLowerCase()];
    if (!p) return { error: `不认识的平台「${w}」，目前支持：${PLATFORM_IDS.map((x) => PLATFORMS[x].name).join("、")}` };
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
const pname = (p: string) => PLATFORMS[p as Platform]?.name ?? p;
const STATUS_LABEL: Record<string, string> = { none: "无状态", watch: "重点关注", contacted: "已联系", excluded: "已排除" };

export const TOOLS: ToolDef[] = [
  /* ───────── 查询 ───────── */
  { name: "overview", label: "总览", description: "总览：各竞品的投放账号数、高频复投数、本周新增", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "总览", args: [] }), data: () => dataOverview() },
  { name: "list_competitors", label: "竞品列表", description: "列出所有监测中的竞品", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "竞品", args: [] }) },
  {
    name: "competitor_detail", label: "竞品详情", description: "某个竞品的详情：监测词、账号数、复投 Top、层级分布、最近任务", role: "member",
    schema: { type: "object", properties: { competitor: comp }, required: ["competitor"] },
    toCommand: (a) => need(a.competitor, "竞品名") ? { error: "请告诉我是哪个竞品" } : { name: "竞品", args: [str(a.competitor)] },
    data: (a) => dataCompetitor(a),
  },
  {
    name: "repeat_accounts", label: "复投", description: "高频复投账号（被竞品反复投放的 KOL）。不指定竞品则看全部", role: "member",
    schema: { type: "object", properties: { competitor: comp } },
    toCommand: (a) => ({ name: "复投", args: str(a.competitor) ? [str(a.competitor)] : [] }),
    data: (a) => dataAccounts("repeat", a),
  },
  {
    name: "new_accounts", label: "新增", description: "近 7 天首次发现的新账号。不指定竞品则看全部", role: "member",
    schema: { type: "object", properties: { competitor: comp } },
    toCommand: (a) => ({ name: "新增", args: str(a.competitor) ? [str(a.competitor)] : [] }),
    data: (a) => dataAccounts("new", a),
  },
  {
    name: "search_accounts", label: "账号搜索", description: "按账号名称/UID/备注关键词搜索已抓取的账号", role: "member",
    schema: { type: "object", properties: { keyword: { type: "string", description: "账号名称关键词" } }, required: ["keyword"] },
    toCommand: (a) => need(a.keyword, "搜索关键词") ? { error: "你想搜哪个账号？" } : { name: "账号", args: [str(a.keyword)] },
    data: (a) => dataAccounts("search", a),
  },
  {
    name: "account_detail", label: "账号详情", description: "某个账号的详情：平台、粉丝、投放次数、投放过哪些竞品、相关作品（标题/点赞/播放）", role: "member",
    schema: { type: "object", properties: { keyword: { type: "string", description: "账号名称（尽量完整）" } }, required: ["keyword"] },
    run: (a, ctx) => need(a.keyword, "账号名") ? Promise.resolve({ text: "你想看哪个账号？" }) : accountDetailCard(a, ctx),
    data: (a) => dataAccountDetail(a),
  },
  {
    name: "compare_competitors", label: "对比", description: "对比两个竞品：共同合作的 KOL 与各自独占数", role: "member",
    schema: { type: "object", properties: { competitor_a: comp, competitor_b: comp }, required: ["competitor_a", "competitor_b"] },
    toCommand: (a) => need(a.competitor_a, "竞品") || need(a.competitor_b, "竞品") ? { error: "对比需要两个竞品名，例如「对比 LibTV 和 即梦AI」" } : { name: "对比", args: [str(a.competitor_a), str(a.competitor_b)] },
    data: (a) => dataCompare(a),
  },
  {
    name: "trend", label: "趋势", description: "每周投放作品数的趋势（近 4–12 周）。不指定竞品则看全部竞品", role: "member",
    schema: { type: "object", properties: { competitor: comp, weeks: { type: "string", description: "周数，4–12，默认 8" } } },
    run: (a, ctx) => trendCard(a, ctx), data: (a) => dataTrend(a),
  },
  {
    name: "weekly_report", label: "周报", description: "本周竞品投放周报：整体数字、各竞品本周 vs 上周、新面孔", role: "member",
    schema: { type: "object", properties: {} }, analyzeByDefault: true,
    run: async (_a, ctx) => ({ card: digestCard(ctx.baseUrl) }), data: () => digestData(),
  },
  {
    name: "list_tasks", label: "任务", description: "查看最近的抓取任务；给出 task_id 则看该任务的状态与进度", role: "member",
    schema: { type: "object", properties: { task_id: { type: "string", description: "任务编号，纯数字，可选" } } },
    toCommand: (a) => ({ name: "任务", args: /^\d{1,9}$/.test(str(a.task_id)) ? [str(a.task_id)] : [] }),
    data: (a) => dataTasks(a),
  },
  { name: "usage", label: "用量", description: "今日 TikHub API 调用量、预算与缓存命中率，以及智能问答的调用量", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "用量", args: [] }), data: () => dataUsage() },
  { name: "alerts", label: "提醒", description: "最近的系统提醒", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "提醒", args: [] }), data: () => dataAlerts() },
  {
    name: "export_excel", label: "导出", description: "导出 Excel 文件并发送：accounts=账号列表，report=竞品监测报告（多工作表）", role: "member",
    schema: { type: "object", properties: { kind: { type: "string", description: "导出内容", enum: ["accounts", "report"] }, competitor: comp }, required: ["kind", "competitor"] },
    toCommand: (a) => {
      if (!["accounts", "report"].includes(str(a.kind))) return { error: "导出内容只能是账号列表或监测报告" };
      if (need(a.competitor, "竞品名")) return { error: "请告诉我导出哪个竞品" };
      return { name: "导出", args: [str(a.kind) === "report" ? "报告" : "账号", str(a.competitor)] };
    },
  },

  /* ───────── 修改（只提议，确认后才执行） ───────── */
  {
    name: "run_crawl", label: "抓取", description: "发起一次新的抓取，更新某竞品的投放数据（会消耗 API 额度，仅在用户明确要求抓取/更新数据时使用）", role: "admin", billed: true,
    schema: { type: "object", properties: { competitor: comp, days: { type: "string", description: "时间范围（天），1–365，默认 30" } }, required: ["competitor"] },
    toCommand: (a) => {
      if (need(a.competitor, "竞品名")) return { error: "请告诉我抓取哪个竞品" };
      const d = Number(a.days);
      return { name: "抓取", args: [str(a.competitor), ...(Number.isFinite(d) && d >= 1 && d <= 365 ? [`${Math.round(d)}天`] : [])] };
    },
    propose: (a) => {
      if (need(a.competitor, "竞品名")) return { error: "请告诉我抓取哪个竞品" };
      const f = findCompetitor(str(a.competitor));
      if ("error" in f) return { error: f.error };
      const d = Number(a.days);
      const days = Number.isFinite(d) && d >= 1 && d <= 365 ? Math.round(d) : 30;
      const cfg = configForCompetitor(f.c.id, days, 3);
      return { summary: `即将抓取「${f.c.name}」近 ${days} 天（预估约 ${cfg ? estimateCalls(cfg) : 0} 次 API 调用）。`, payload: { competitorId: f.c.id, name: f.c.name, days } };
    },
    execute: async (p, ctx) => {
      const r = await ctx.backend.runCompetitor(Number(p.competitorId), Number(p.days));
      watchTask(r.id, ctx.chatId, ctx.sender, ctx.baseUrl);
      return { text: `已发起「${p.name}」抓取（任务 #${r.id}，近 ${p.days} 天，预估约 ${r.estimate} 次调用）。完成后我会在这里通知你。` };
    },
  },
  {
    name: "add_competitor", label: "新增竞品", description: "新增一个监测竞品。需要用户给出竞品名称、监测关键词、平台，缺哪个就先追问，不要替用户编造", role: "admin",
    schema: {
      type: "object", required: ["name", "keywords", "platforms"],
      properties: {
        name: { type: "string", description: "竞品名称" },
        keywords: { type: "string", description: "监测关键词，用逗号分隔" },
        platforms: { type: "string", description: "平台，用逗号分隔，可选：抖音、小红书、快手、B站" },
      },
    },
    propose: (a) => {
      const name = str(a.name).slice(0, 30), keywords = list(a.keywords), platforms = parsePlatforms(a.platforms);
      if (!name) return { error: "新竞品叫什么名字？" };
      if (listCompetitors().some((c) => c.name.toLowerCase() === name.toLowerCase())) return { error: `竞品「${name}」已经存在。想改监测词的话，可以说“给 ${name} 加监测词 xxx”。` };
      if (!keywords.length) return { error: `「${name}」要监测哪些关键词？（用逗号分隔）` };
      if ("error" in platforms) return { error: platforms.error };
      if (!platforms.length) return { error: `「${name}」要监测哪些平台？可选：${PLATFORM_IDS.map((x) => PLATFORMS[x].name).join("、")}` };
      return { summary: `即将新增竞品「${name}」\n监测词：${keywords.join("、")}\n平台：${platforms.map(pname).join("、")}`, payload: { name, keywords, platforms } };
    },
    execute: async (p) => {
      if (listCompetitors().some((c) => c.name.toLowerCase() === String(p.name).toLowerCase())) return { text: `竞品「${p.name}」已经存在，未重复创建。` };
      const id = saveCompetitor({ name: p.name, keywords: p.keywords, platforms: p.platforms });
      return { text: `已新增竞品「${p.name}」（#${id}）。要开始抓取的话告诉我，例如“抓取 ${p.name} 近 30 天”。` };
    },
  },
  {
    name: "update_keywords", label: "改监测词", description: "给某个竞品增加或移除监测关键词", role: "admin",
    schema: { type: "object", required: ["competitor"], properties: { competitor: comp, add: { type: "string", description: "要增加的关键词，逗号分隔" }, remove: { type: "string", description: "要移除的关键词，逗号分隔" } } },
    propose: (a) => {
      if (need(a.competitor, "竞品名")) return { error: "要改哪个竞品的监测词？" };
      const f = findCompetitor(str(a.competitor));
      if ("error" in f) return { error: f.error };
      const add = list(a.add), remove = list(a.remove);
      if (!add.length && !remove.length) return { error: `要给「${f.c.name}」加哪些词、或去掉哪些词？` };
      const rm = new Set(remove.map((k) => k.toLowerCase()));
      const next = [...new Set([...f.c.keywords, ...add])].filter((k) => !rm.has(k.toLowerCase()));
      if (!next.length) return { error: "不能把监测词删光，至少保留一个。" };
      if (next.length === f.c.keywords.length && next.every((k) => f.c.keywords.includes(k))) return { error: `「${f.c.name}」的监测词没有变化（${f.c.keywords.join("、")}）。` };
      return { summary: `即将修改「${f.c.name}」的监测词\n${add.length ? `新增：${add.join("、")}\n` : ""}${remove.length ? `移除：${remove.join("、")}\n` : ""}改后：${next.join("、")}`, payload: { competitorId: f.c.id, keywords: next } };
    },
    execute: async (p) => {
      const c = getCompetitor(Number(p.competitorId));
      if (!c) return { text: "这个竞品已经不存在了。" };
      saveCompetitor({ name: c.name, color: c.color, keywords: p.keywords, platforms: c.platforms, note: c.note }, c.id);
      return { text: `已更新「${c.name}」的监测词：${(p.keywords as string[]).join("、")}。新词会在下次抓取时生效。` };
    },
  },
  {
    name: "tag_account", label: "标记账号", description: "给某个已抓取的账号打标签、改状态（重点关注/已联系/已排除）或写备注", role: "admin",
    schema: {
      type: "object", required: ["keyword"],
      properties: {
        keyword: { type: "string", description: "账号名称（尽量完整，需唯一对应一个账号）" },
        tags: { type: "string", description: "要追加的标签，逗号分隔" },
        status: { type: "string", description: "状态：watch=重点关注，contacted=已联系，excluded=已排除，none=清除状态", enum: ["none", "watch", "contacted", "excluded"] },
        note: { type: "string", description: "备注（会覆盖原备注）" },
      },
    },
    propose: (a) => {
      const kw = str(a.keyword);
      if (!kw) return { error: "要标记哪个账号？" };
      const tags = list(a.tags), status = str(a.status), note = str(a.note).slice(0, 200);
      if (status && !(status in STATUS_LABEL)) return { error: "状态只能是：重点关注 / 已联系 / 已排除 / 无状态" };
      if (!tags.length && !status && !note) return { error: "想给它打什么标签、或设成什么状态？" };
      const rows = accountRows({ q: kw });
      const exact = rows.filter((r) => r.name === kw);
      const hit = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
      if (!rows.length) return { error: `没有找到包含「${kw}」的账号。` };
      if (!hit) return { error: `匹配到 ${rows.length} 个账号：${rows.slice(0, 5).map((r) => r.name).join("、")}${rows.length > 5 ? " 等" : ""}，请说得更具体些。` };
      const merged = [...new Set([...hit.tags, ...tags])].slice(0, 10);
      return {
        summary: `即将标记账号「${hit.name}」（${pname(hit.platform)}）\n${tags.length ? `追加标签：${tags.join("、")}\n` : ""}${status ? `状态：${STATUS_LABEL[status]}\n` : ""}${note ? `备注：${note}` : ""}`.trimEnd(),
        payload: { platform: hit.platform, uid: hit.uid, name: hit.name, tags: merged, ...(status ? { status } : {}), ...(note ? { note } : {}) },
      };
    },
    execute: async (p) => {
      saveAccountMeta(String(p.platform), String(p.uid), { tags: p.tags as string[], ...(p.status ? { status: String(p.status) } : {}), ...(p.note ? { note: String(p.note) } : {}) });
      return { text: `已标记账号「${p.name}」。` };
    },
  },

  /* ───────── 设置（管理员，立即生效，无计费、可逆） ───────── */
  {
    name: "digest_settings", label: "周报设置", description: "开启/关闭每周自动推送的周报，或设置推送时间；推送给已订阅的会话。action=status 查看当前设置", role: "admin",
    schema: {
      type: "object", required: ["action"],
      properties: {
        action: { type: "string", description: "on 开启、off 关闭、status 查看", enum: ["on", "off", "status"] },
        weekday: { type: "string", description: "周几，如 周一、周五，可选" },
        hour: { type: "string", description: "几点（0–23），可选" },
      },
    },
    run: async (a) => {
      const act = str(a.action) || "status";
      const wd = a.weekday !== undefined && str(a.weekday) ? parseWeekday(a.weekday) : undefined;
      const hr = a.hour !== undefined && str(a.hour) ? parseHour(a.hour) : undefined;
      if (wd === null) return { text: "没听懂是周几，可以说“周一”到“周日”。" };
      if (hr === null) return { text: "几点推送？请给 0–23 之间的整点，例如“9点”。" };
      const cfg = act === "off" ? setDigestCfg({ enabled: false }) : act === "on" ? setDigestCfg({ enabled: true, ...(wd !== undefined ? { weekday: wd } : {}), ...(hr !== undefined ? { hour: hr } : {}) }) : getDigestCfg();
      const subs = (db().prepare("SELECT COUNT(*) c FROM bot_subs").get() as { c: number }).c;
      const when = `每周${WEEKDAY_LABEL[cfg.weekday]} ${cfg.hour}:00`;
      return { text: `${cfg.enabled ? `周报已开启：${when} 推送` : "周报未开启"}${cfg.enabled && !subs ? "。目前还没有订阅会话——请在要接收的群里发送「订阅」" : ""}。` };
    },
  },
  {
    name: "subscribe", label: "订阅", description: "把当前会话加入（on）或移出（off）提醒与周报的推送", role: "admin",
    schema: { type: "object", required: ["action"], properties: { action: { type: "string", description: "on 订阅、off 退订", enum: ["on", "off"] } } },
    toCommand: (a) => ({ name: str(a.action) === "off" ? "退订" : "订阅", args: [] }),
  },
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

export type ToolCall = { tool: string; args: Record<string, unknown> };
export type Plan = {
  calls: ToolCall[];
  /** 需要向用户追问时的问题（此时不执行任何工具） */
  clarify?: string;
  /** 查询完成后让模型做一次解读；值为关注点（一句话） */
  analyze?: string;
  source: "rules" | "llm";
};

/** 展示给用户的"我理解为…" */
export function describeCall(c: ToolCall): string {
  const t = toolByName(c.tool);
  const cmd = t?.toCommand?.(c.args);
  if (cmd && "name" in cmd) return [cmd.name, ...cmd.args].join(" ");
  if (!t) return c.tool;
  const vals = Object.values(c.args).map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 3);
  return [t.label, ...vals].join(" ");
}
