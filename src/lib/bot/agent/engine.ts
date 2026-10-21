// 意图层引擎：自然语言 → 计划（规则优先，其次大模型）→ 校验 → 执行 →（可选）解读。
//
//   · 查询类工具直接执行，复用现有指令的卡片；
//   · 修改类工具（抓取 / 新增竞品 / 改监测词 / 标记账号）只"提议"并落库，用户回复「确认」才真正执行，权限以执行时为准；
//   · 解读阶段把查询结果交给大模型写几句话，但那一次调用不带任何工具（见 llm.ts 头部的信任边界说明）。
import { listCompetitors } from "../../queries";
import { runCommand } from "../commands";
import type { BotCtx, Progress, Reply } from "../types";
import { llmAnalyze, llmConfigured, llmPlan, type AnalysisPart, type LlmDeps } from "./llm";
import { hasPendingAction, setPending, takePending, __resetPending } from "./pending";
import { isWriteIntent, ruleIntent, wantsAnalysis } from "./rules";
import { loadSession, saveTurn, __resetSessions } from "./session";
import { describeCall, toolByName, type Plan } from "./tools";

type Env = Record<string, string | undefined>;

/** off：关闭；rules：仅规则（默认，免费）；llm：规则未命中 / 需要多轮上下文 / 需要解读时再用大模型（需配置提供方的 key） */
export type AgentMode = "off" | "rules" | "llm";
export function agentMode(env: Env = process.env): AgentMode {
  const m = env.BOT_AGENT;
  return m === "off" || m === "llm" ? m : "rules";
}

export const CONFIRM_RE = /^(确认|确定|是的?|好的?|ok|yes|y|执行|开始|go|可以)[!！。.\s]*$/i;
export const CANCEL_RE = /^(取消|算了|不用了?|不了|不要|no|n|放弃)[!！。.\s]*$/i;

export const __resetAgentState = () => { __resetPending(); __resetSessions(); };

export const hasPending = (ctx: BotCtx): boolean => hasPendingAction(ctx);

export function cancelPending(ctx: BotCtx): Reply {
  takePending(ctx);
  return { text: "已取消。" };
}

export async function confirmPending(ctx: BotCtx): Promise<Reply> {
  const p = takePending(ctx); // 取出即删除：确认只能用一次
  if (!p) return { text: "没有待确认的操作，或已超时。" };
  const tool = toolByName(p.kind);
  if (!tool?.execute) return { text: "这个待办已经失效，请重新说一遍。" };
  if (tool.role === "admin" && ctx.role !== "admin") return { text: tool.billed ? "抓取仅管理员可用。" : "该操作仅管理员可用。" }; // 权限以执行时为准，而不是提议时
  return tool.execute(p.payload, ctx);
}

export type AgentDeps = LlmDeps & { mode?: AgentMode; progress?: Progress };
export type NLResult = { replies: Reply[]; understood?: string; source?: Plan["source"]; analysis?: string; note?: string } | null;

const DENY = (billed?: boolean) => (billed ? "抓取会消耗 API 额度，仅管理员可发起。" : "这个操作仅管理员可用。");
const LONG = 40; // 超过这个长度的句子规则吃不准，直接交给大模型（若已配置）

export async function handleNaturalLanguage(text: string, ctx: BotCtx, deps: AgentDeps = {}): Promise<NLResult> {
  const env = deps.env ?? process.env;
  const mode = deps.mode ?? agentMode(env);
  if (mode === "off") return null;
  const ready = mode === "llm" && llmConfigured(env);

  const write = isWriteIntent(text);
  if (write && !ready) {
    return { replies: [{ text: "新增竞品、改监测词、标记账号这类操作需要开启智能模式（BOT_AGENT=llm 并配置大模型），目前请先在控制台操作。" }], source: "rules" };
  }

  const catalog = listCompetitors();
  const session = loadSession(ctx);
  const last = catalog.find((c) => c.name === session.last.competitor)?.name;

  let plan: Plan | null = null;
  let triedRules = false;
  if (!write && !(ready && text.length > LONG)) { plan = ruleIntent(text, catalog, { last }); triedRules = true; }
  if (!plan && ready) {
    await deps.progress?.step("🤔 正在理解你的问题…");
    plan = await llmPlan(text, catalog, ctx.role === "admin" ? "admin" : "member", { ...deps, env, userId: ctx.userId, session });
  }
  if (!plan && !write && !triedRules) plan = ruleIntent(text, catalog, { last }); // 长句交给模型却没拿到结果：回落到规则
  if (!plan) return null;
  if (plan.clarify) return { replies: [{ text: plan.clarify }], source: plan.source };

  // 规则能认出"要什么数据"，但解读（"为什么/怎么看"）需要模型；这样规则路径只花一次模型调用
  if (plan.source === "rules" && ready && plan.calls.length && wantsAnalysis(text)) plan.analyze = text.slice(0, 100);

  const calls = plan.calls.slice(0, 3);
  if ((plan.source === "llm" || plan.analyze) && calls.length) await deps.progress?.step(`🔎 正在查询：${calls.map(describeCall).join("、")}`);

  const replies: Reply[] = [];
  const parts: AnalysisPart[] = [];
  const done = new Set<string>();
  const understood: string[] = [];
  let proposed = false, byDefault = false;

  for (const call of calls) {
    const id = JSON.stringify(call);
    if (done.has(id)) continue;
    done.add(id);
    const tool = toolByName(call.tool);
    if (!tool) continue; // 模型编造的工具名：直接忽略
    if (tool.role === "admin" && ctx.role !== "admin") { replies.push({ text: DENY(tool.billed) }); continue; } // 先挡权限，避免成员被引导进确认流程

    if (tool.propose) {
      if (proposed) { replies.push({ text: "一次只能确认一个修改操作，请先处理上一个。" }); continue; }
      const p = tool.propose(call.args, ctx);
      if ("error" in p) { replies.push({ text: p.error }); continue; }
      proposed = true;
      understood.push(describeCall(call));
      setPending(ctx, { kind: tool.name, payload: p.payload, summary: p.summary });
      replies.push({ text: `${p.summary}\n回复「确认」执行，「取消」放弃（5 分钟内有效）。` });
      continue;
    }

    let reply: Reply;
    if (tool.toCommand) {
      const cmd = tool.toCommand(call.args);
      if ("error" in cmd) { replies.push({ text: cmd.error }); continue; }
      understood.push(describeCall(call));
      reply = await runCommand(cmd.name, cmd.args, ctx);
    } else if (tool.run) {
      understood.push(describeCall(call));
      reply = await tool.run(call.args, ctx);
    } else continue;
    replies.push(reply);

    if (tool.data) {
      try {
        const data = tool.data(call.args, ctx);
        if (!(data && typeof data === "object" && "error" in data)) parts.push({ tool: tool.name, args: call.args, data });
      } catch (e) { console.error("[bot] tool data", tool.name, e); }
    }
    if (tool.analyzeByDefault) byDefault = true;
  }

  let analysis: string | undefined, note: string | undefined;
  if (ready && parts.length && (plan.analyze || byDefault)) {
    await deps.progress?.step("📊 正在分析数据…");
    const r = await llmAnalyze(text, plan.analyze ?? text.slice(0, 100), parts, { ...deps, env, userId: ctx.userId });
    analysis = r.text; note = r.note;
  }

  if (understood.length) {
    // 记住这一轮：下一句的"它 / 那新增呢"靠它解析。竞品名只取名单里存在的
    const mentioned = calls.map((c) => String(c.args.competitor ?? c.args.competitor_a ?? c.args.name ?? "").toLowerCase()).find(Boolean);
    const comp = catalog.find((c) => c.name.toLowerCase() === mentioned)?.name;
    saveTurn(ctx, text, understood.join("；"), comp ? { competitor: comp } : {});
  }
  return { replies, understood: understood.length ? understood.join("；") : undefined, source: plan.source, analysis, note };
}
