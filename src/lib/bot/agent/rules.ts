// 规则意图解析：零成本、离线、可预测。覆盖最常见的说法；没命中再交给大模型（若已配置）。
import type { Plan, ToolCall } from "./tools";

export type Catalog = Array<{ name: string }>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 文本里出现的竞品（按名称长度降序匹配，避免 "Lib" 抢走 "LibTV"）。 */
export function mentionedCompetitors(text: string, catalog: Catalog): string[] {
  const t = norm(text);
  const hits: Array<{ name: string; at: number }> = [];
  let rest = t;
  for (const c of [...catalog].sort((a, b) => b.name.length - a.name.length)) {
    const n = norm(c.name);
    const at = n ? rest.indexOf(n) : -1;
    if (at >= 0) {
      hits.push({ name: c.name, at: t.indexOf(n) });
      rest = rest.replace(n, "#".repeat(n.length)); // 占位，防止子串重复命中
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

export function extractDays(text: string): number | null {
  const m = /(?:近|最近|过去)?\s*(\d{1,3})\s*(?:天|日)/.exec(text);
  if (m) return Math.min(Math.max(+m[1], 1), 365);
  if (/(一周|一星期|七天|本周|这周|上周)/.test(text)) return 7;
  if (/(半年|六个月)/.test(text)) return 180;
  if (/(一个月|本月|这个月|近一月|最近一月|三十天)/.test(text)) return 30;
  if (/(季度|三个月)/.test(text)) return 90;
  return null;
}

const RE = {
  exportIt: /(导出|下载|excel|xlsx|表格|报表|发我.*(文件|表))/i,
  report: /(报告|报表|汇总|周报|月报)/,
  run: /(抓取|抓一下|抓一抓|爬取|爬一下|重新(抓|跑|爬)|跑一下|跑一遍|更新(一下)?(数据|账号)?|刷新)/,
  compare: /(对比|比较|比一比|比一下|\bvs\b|和.{1,20}比|撞|重合|共同)/i,
  repeat: /(复投|反复|多次(投放|合作)|重复(投放|合作)|深度绑定|常合作|老客户|长期合作|核心.{0,2}(kol|达人|账号))/i,
  fresh: /(新增|新账号|新出现|新投放|新合作|新面孔|新的(账号|达人|博主)|新冒出|有.{0,3}新)/,
  task: /(进度|跑完|跑到哪|任务|状态|完成了吗|好了吗)/,
  usage: /(用量|预算|花了多少|调用了多少|额度|消耗)/,
  alerts: /(提醒|告警|通知|有什么事)/,
  overview: /(总览|概况|整体|大盘|总体|全局|所有竞品|各个竞品|各竞品)/,
  detail: /(情况|怎么样|怎样|详情|数据|投放|动态|表现)/,
  search: /(找|搜|查|看看).{0,6}(账号|博主|达人|kol|up主)/i,
  weekly: /(周报|(本|这)周(的)?(总结|情况|动态|概况|小结))/,
  trend: /(趋势|走势|曲线|增长|涨了|跌了|每周|周度|近.{1,3}周)/,
};

/** 用户要的是"分析解读"而不只是列数据 → 查完之后再让模型解读一次（需要大模型）。 */
const ANALYZE_RE = /(为什么|为何|原因|分析|解读|总结|复盘|怎么看|怎么回事|意味着|说明什么|有什么(变化|区别|不同|特点|规律)|变化|洞察|建议|应该|值得)/;
export const wantsAnalysis = (text: string) => ANALYZE_RE.test(text);

/** 指代上一轮讨论的竞品："它""刚才那个""那新增呢"。 */
const PRONOUN_RE = /(它|他们|她们|这个|那个|这家|那家|刚才|上面|上一个|前面那|^那)/;

/**
 * 修改类意图（新增竞品、改监测词、标记账号、周报开关）需要抽取多个参数，规则做不好也不该做——
 * 交给大模型；没开大模型时由引擎提示。必须先于下面的查询规则判断，否则"新增竞品…"会被当成"新增账号"查询。
 */
const WRITE_RE = /((添加|新增|新建|创建|增加|加上?|删除|删掉|去掉|移除|修改|更新|调整|改成?)\s*(一个|个)?\s*(竞品|监测词|关键词)(?!数据|账号)|(标记|标注|打上?|加上?).{0,12}(标签|重点关注|已联系|排除)|(开启|打开|关闭|停止|取消|设置|设为|改到).{0,6}周报|周报.{0,6}(开启|关闭|推送|改到))/;
export const isWriteIntent = (text: string) => WRITE_RE.test(text);

/** 返回 null 表示规则无法判断，交给后续环节。 */
export function ruleIntent(text: string, catalog: Catalog, opts: { last?: string } = {}): Plan | null {
  const t = text.trim();
  if (!t) return null;
  if (isWriteIntent(t)) return null;
  let comps = mentionedCompetitors(t, catalog);
  // "它 / 那新增呢"：沿用上一轮讨论的竞品（必须仍在名单里）
  if (!comps.length && opts.last && catalog.some((c) => c.name === opts.last) && PRONOUN_RE.test(t)) comps = [opts.last];
  const days = extractDays(t);
  const mk = (calls: ToolCall[]): Plan => ({ calls, source: "rules" });
  const ask = (q: string): Plan => ({ calls: [], clarify: q, source: "rules" });
  const names = catalog.map((c) => c.name).join("、") || "（还没有竞品，请先在控制台创建）";

  if (RE.exportIt.test(t)) {
    if (!comps.length) return ask(`导出哪个竞品？现有：${names}`);
    const kind = RE.report.test(t) ? "report" : "accounts";
    return mk(comps.map((c) => ({ tool: "export_excel", args: { kind, competitor: c } })).slice(0, 2));
  }
  if (RE.run.test(t)) {
    if (!comps.length) return ask(`抓取哪个竞品？现有：${names}`);
    return mk([{ tool: "run_crawl", args: { competitor: comps[0], ...(days ? { days } : {}) } }]);
  }
  if (RE.compare.test(t)) {
    if (comps.length < 2) return ask(`要对比哪两个竞品？现有：${names}`);
    return mk([{ tool: "compare_competitors", args: { competitor_a: comps[0], competitor_b: comps[1] } }]);
  }
  if (RE.weekly.test(t)) return mk([{ tool: "weekly_report", args: {} }]);
  if (RE.trend.test(t) && !RE.fresh.test(t)) return mk([{ tool: "trend", args: comps[0] ? { competitor: comps[0] } : {} }]);
  if (RE.repeat.test(t)) return mk([{ tool: "repeat_accounts", args: comps[0] ? { competitor: comps[0] } : {} }]);
  if (RE.fresh.test(t)) return mk([{ tool: "new_accounts", args: comps[0] ? { competitor: comps[0] } : {} }]);
  if (RE.usage.test(t)) return mk([{ tool: "usage", args: {} }]);
  if (RE.task.test(t)) {
    const id = /#?(\d{1,9})\s*号?任务|任务\s*#?(\d{1,9})|#(\d{1,9})/.exec(t);
    return mk([{ tool: "list_tasks", args: id ? { task_id: id[1] ?? id[2] ?? id[3] } : {} }]);
  }
  if (RE.alerts.test(t)) return mk([{ tool: "alerts", args: {} }]);
  if (RE.search.test(t)) {
    const kw = t.replace(/(帮我|请|看看|找一下|找找|找|搜索|搜|查一下|查|个|一下|账号|博主|达人|kol|up主)/gi, " ").replace(/\s+/g, " ").trim();
    return kw ? mk([{ tool: "search_accounts", args: { keyword: kw } }]) : ask("你想找哪个账号？说个名字关键词就行");
  }
  if (RE.overview.test(t) && !comps.length) return mk([{ tool: "overview", args: {} }]);
  // 同时提到两个竞品又没说要什么：最可能想看它们的关系
  if (comps.length >= 2) return mk([{ tool: "compare_competitors", args: { competitor_a: comps[0], competitor_b: comps[1] } }]);
  if (comps.length) return mk([{ tool: "competitor_detail", args: { competitor: comps[0] } }]);
  if (RE.overview.test(t) || RE.detail.test(t)) return mk([{ tool: "overview", args: {} }]);
  return null;
}
