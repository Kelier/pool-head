// 大模型意图解析（可选）。只把「用户这句话 + 竞品名单」发给模型，换回「工具调用 + 参数」。
// 安全：不把任何抓取到的内容（账号名、作品标题等不可信文本）发给模型；执行仍走同一套权限/限流/预算/确认，模型无法绕过。
//
// 提供方（BOT_LLM_PROVIDER，默认 deepseek）：
//   deepseek   OpenAI 兼容接口，默认模型 deepseek-flash，显式关闭思考模式（分类任务不需要，省延迟与费用）
//   anthropic  Claude Messages API，默认模型 claude-haiku-5-5
//   openai     任意 OpenAI 兼容服务（BOT_LLM_BASE_URL + BOT_LLM_API_KEY + BOT_LLM_MODEL）
import { TOOLS, type Plan, type ToolCall } from "./tools";

type Env = Record<string, string | undefined>;
export type LlmDeps = { fetch?: typeof fetch; env?: Env; today?: () => string };

export type Provider = "deepseek" | "anthropic" | "openai";
export type LlmConfig = { provider: Provider; key: string; baseUrl: string; model: string };

/** 解析环境变量；缺 key（或 openai 缺 base/model）时返回 null = 未配置。 */
export function llmConfig(env: Env = process.env): LlmConfig | null {
  const p = (env.BOT_LLM_PROVIDER || "deepseek").toLowerCase();
  const trim = (u: string) => u.replace(/\/$/, "");
  if (p === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) return null;
    return { provider: "deepseek", key: env.DEEPSEEK_API_KEY, baseUrl: trim(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"), model: env.BOT_LLM_MODEL || "deepseek-flash" };
  }
  if (p === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return null;
    return { provider: "anthropic", key: env.ANTHROPIC_API_KEY, baseUrl: trim(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"), model: env.BOT_LLM_MODEL || "claude-haiku-5-5" };
  }
  if (p === "openai") {
    if (!env.BOT_LLM_API_KEY || !env.BOT_LLM_BASE_URL || !env.BOT_LLM_MODEL) return null;
    return { provider: "openai", key: env.BOT_LLM_API_KEY, baseUrl: trim(env.BOT_LLM_BASE_URL), model: env.BOT_LLM_MODEL };
  }
  return null;
}

export const llmConfigured = (env: Env = process.env) => llmConfig(env) !== null;

// 每日调用上限（进程内计数）：防止被刷导致账单失控
const usage = { day: "", n: 0 };
const dayKey = () => new Date().toLocaleDateString("sv-SE");
export const __resetLlmUsage = () => { usage.day = ""; usage.n = 0; };

type Catalog = Array<{ name: string; keywords?: string[] }>;

function systemPrompt(catalog: Catalog, today: string) {
  return [
    "你是「竞品投放监测」飞书机器人的意图解析器：把用户的一句话转换成对工具的调用。",
    "规则：",
    "1. 只能通过工具获取信息，不要编造任何数据，也不要自己回答业务数字。",
    "2. 竞品名必须来自下面的名单；用户说的名字不确定或不在名单里时，用一句话追问，不要猜。",
    "3. 只有用户明确要求“抓取 / 更新数据 / 重新跑”时才调用 run_crawl（它会消耗 API 额度）；“看看/查查/最近有没有”只用查询工具。",
    "4. 信息不足时，用一句话向用户追问，不调用工具。",
    "5. 与竞品投放监测无关的话题，礼貌说明你只能做这方面的查询。",
    "6. 一次最多调用 3 个工具；回复用中文，不超过 80 字。",
    `当前日期：${today}`,
    "竞品名单：",
    ...(catalog.length ? catalog.map((c) => `- ${c.name}${c.keywords?.length ? `（监测词：${c.keywords.slice(0, 4).join("、")}）` : ""}`) : ["（暂无竞品）"]),
  ].join("\n");
}

type Raw = { text: string; calls: ToolCall[] };

async function callOpenAICompatible(cfg: LlmConfig, system: string, user: string, tools: typeof TOOLS, f: typeof fetch, timeout: number): Promise<Raw | null> {
  const r = await f(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })),
      tool_choice: "auto",
      max_tokens: 400,
      temperature: 0,
      // DeepSeek 默认开启思考模式；意图分类不需要，关掉更快更省
      ...(cfg.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) {
    console.error("[bot] llm http", cfg.provider, r.status, (await r.text()).slice(0, 200));
    return null;
  }
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
  const msg = j.choices?.[0]?.message;
  const calls: ToolCall[] = [];
  for (const tc of msg?.tool_calls ?? []) {
    const name = tc.function?.name;
    if (!name) continue;
    try {
      const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      if (args && typeof args === "object" && !Array.isArray(args)) calls.push({ tool: name, args });
    } catch {
      console.error("[bot] llm: 工具参数不是合法 JSON，已忽略", name); // 官方文档提醒：模型可能生成非法 JSON，需自行校验
    }
  }
  return { text: (msg?.content ?? "").trim(), calls };
}

async function callAnthropic(cfg: LlmConfig, system: string, user: string, tools: typeof TOOLS, f: typeof fetch, timeout: number): Promise<Raw | null> {
  const r = await f(`${cfg.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: cfg.model, max_tokens: 400, system,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) {
    console.error("[bot] llm http", cfg.provider, r.status, (await r.text()).slice(0, 200));
    return null;
  }
  const j = (await r.json()) as { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> };
  const blocks = j.content ?? [];
  return {
    text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim(),
    calls: blocks.filter((b) => b.type === "tool_use" && b.name).map((b) => ({ tool: b.name!, args: b.input ?? {} })),
  };
}

export async function llmPlan(text: string, catalog: Catalog, role: "admin" | "member", deps: LlmDeps = {}): Promise<Plan | null> {
  const env = deps.env ?? process.env;
  const cfg = llmConfig(env);
  if (!cfg) return null;

  const d = dayKey();
  if (usage.day !== d) { usage.day = d; usage.n = 0; }
  const cap = Number(env.BOT_LLM_DAILY_CAP ?? 200);
  if (usage.n >= cap) return { calls: [], clarify: "今天的智能解析额度已用完，请直接用指令（发送「帮助」查看）。", source: "llm" };
  usage.n++;

  // 不是管理员就不给 run_crawl，模型也就提不出抓取
  const tools = TOOLS.filter((t) => role === "admin" || t.role === "member");
  const system = systemPrompt(catalog, deps.today?.() ?? d);
  const timeout = Number(env.BOT_LLM_TIMEOUT_MS ?? 15_000);
  const f = deps.fetch ?? fetch;
  try {
    const raw = await (cfg.provider === "anthropic" ? callAnthropic : callOpenAICompatible)(cfg, system, text.slice(0, 500), tools, f, timeout);
    if (!raw) return null;
    if (raw.calls.length) return { calls: raw.calls.slice(0, 3), source: "llm" };
    const said = raw.text.slice(0, 300);
    return said ? { calls: [], clarify: said, source: "llm" } : null;
  } catch (e) {
    console.error("[bot] llm", cfg.provider, (e as Error).message);
    return null;
  }
}
