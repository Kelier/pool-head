// 工具注册表：声明一次（名称/描述/JSON Schema/角色/如何映射到指令），规则解析与大模型共用。
// 后续要暴露成 MCP 服务或接入别的 Agent 网关，只需把这张表转一下格式。

export type JsonSchema = { type: "object"; properties: Record<string, { type: string; description: string; enum?: string[] }>; required?: string[] };

export type ToolDef = {
  name: string;
  description: string;
  /** 需要的最低角色 */
  role: "member" | "admin";
  /** 会消耗 TikHub 调用：意图层触发时必须经过二次确认 */
  billed?: boolean;
  schema: JsonSchema;
  /** 参数 → 现有指令（名称 + 参数）。参数非法时返回 error（会原样回给用户，不会执行） */
  toCommand: (args: Record<string, unknown>) => { name: string; args: string[] } | { error: string };
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const need = (v: unknown, label: string) => (str(v) ? null : `缺少${label}`);
const comp = { type: "string", description: "竞品名称，必须是竞品名单里的名字" };

export const TOOLS: ToolDef[] = [
  { name: "overview", description: "总览：各竞品的投放账号数、高频复投数、本周新增", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "总览", args: [] }) },
  { name: "list_competitors", description: "列出所有监测中的竞品", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "竞品", args: [] }) },
  {
    name: "competitor_detail", description: "某个竞品的详情：监测词、账号数、复投 Top、层级分布、最近任务", role: "member",
    schema: { type: "object", properties: { competitor: comp }, required: ["competitor"] },
    toCommand: (a) => need(a.competitor, "竞品名") ? { error: "请告诉我是哪个竞品" } : { name: "竞品", args: [str(a.competitor)] },
  },
  {
    name: "repeat_accounts", description: "高频复投账号（被竞品反复投放的 KOL）。不指定竞品则看全部", role: "member",
    schema: { type: "object", properties: { competitor: comp } },
    toCommand: (a) => ({ name: "复投", args: str(a.competitor) ? [str(a.competitor)] : [] }),
  },
  {
    name: "new_accounts", description: "近 7 天首次发现的新账号。不指定竞品则看全部", role: "member",
    schema: { type: "object", properties: { competitor: comp } },
    toCommand: (a) => ({ name: "新增", args: str(a.competitor) ? [str(a.competitor)] : [] }),
  },
  {
    name: "search_accounts", description: "按账号名称/UID/备注关键词搜索已抓取的账号", role: "member",
    schema: { type: "object", properties: { keyword: { type: "string", description: "账号名称关键词" } }, required: ["keyword"] },
    toCommand: (a) => need(a.keyword, "搜索关键词") ? { error: "你想搜哪个账号？" } : { name: "账号", args: [str(a.keyword)] },
  },
  {
    name: "compare_competitors", description: "对比两个竞品：共同合作的 KOL 与各自独占数", role: "member",
    schema: { type: "object", properties: { competitor_a: comp, competitor_b: comp }, required: ["competitor_a", "competitor_b"] },
    toCommand: (a) => need(a.competitor_a, "竞品") || need(a.competitor_b, "竞品") ? { error: "对比需要两个竞品名，例如「对比 LibTV 和 即梦AI」" } : { name: "对比", args: [str(a.competitor_a), str(a.competitor_b)] },
  },
  {
    name: "list_tasks", description: "查看最近的抓取任务；给出 task_id 则看该任务的状态与进度", role: "member",
    schema: { type: "object", properties: { task_id: { type: "string", description: "任务编号，纯数字，可选" } } },
    toCommand: (a) => ({ name: "任务", args: /^\d{1,9}$/.test(str(a.task_id)) ? [str(a.task_id)] : [] }),
  },
  { name: "usage", description: "今日 TikHub API 调用量、预算与缓存命中率", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "用量", args: [] }) },
  { name: "alerts", description: "最近的系统提醒", role: "member", schema: { type: "object", properties: {} }, toCommand: () => ({ name: "提醒", args: [] }) },
  {
    name: "export_excel", description: "导出 Excel 文件并发送：accounts=账号列表，report=竞品监测报告（多工作表）", role: "member",
    schema: { type: "object", properties: { kind: { type: "string", description: "导出内容", enum: ["accounts", "report"] }, competitor: comp }, required: ["kind", "competitor"] },
    toCommand: (a) => {
      if (!["accounts", "report"].includes(str(a.kind))) return { error: "导出内容只能是账号列表或监测报告" };
      if (need(a.competitor, "竞品名")) return { error: "请告诉我导出哪个竞品" };
      return { name: "导出", args: [str(a.kind) === "report" ? "报告" : "账号", str(a.competitor)] };
    },
  },
  {
    name: "run_crawl", description: "发起一次新的抓取，更新某竞品的投放数据（会消耗 API 额度，仅在用户明确要求抓取/更新数据时使用）", role: "admin", billed: true,
    schema: { type: "object", properties: { competitor: comp, days: { type: "string", description: "时间范围（天），1–365，默认 30" } }, required: ["competitor"] },
    toCommand: (a) => {
      if (need(a.competitor, "竞品名")) return { error: "请告诉我抓取哪个竞品" };
      const d = Number(a.days);
      return { name: "抓取", args: [str(a.competitor), ...(Number.isFinite(d) && d >= 1 && d <= 365 ? [`${Math.round(d)}天`] : [])] };
    },
  },
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

export type ToolCall = { tool: string; args: Record<string, unknown> };
export type Plan = {
  calls: ToolCall[];
  /** 需要向用户追问时的问题（此时不执行任何工具） */
  clarify?: string;
  source: "rules" | "llm";
};

/** 展示给用户的"我理解为…" */
export function describeCall(c: ToolCall): string {
  const t = toolByName(c.tool);
  const cmd = t?.toCommand(c.args);
  return cmd && "name" in cmd ? [cmd.name, ...cmd.args].join(" ") : c.tool;
}
