// 意图层引擎：自然语言 → 计划（规则优先，其次大模型）→ 校验 → 复用现有指令执行；计费动作先确认。
import { listCompetitors } from "../../queries";
import { estimateCalls } from "../../pipeline";
import { configForCompetitor } from "../../scheduler";
import { findCompetitor, runCommand } from "../commands";
import { watchTask } from "../watch";
import type { BotCtx, Reply } from "../types";
import { llmConfigured, llmPlan, type LlmDeps } from "./llm";
import { ruleIntent } from "./rules";
import { describeCall, toolByName, type Plan } from "./tools";

type Env = Record<string, string | undefined>;

/** off：关闭；rules：仅规则（默认，免费）；llm：规则未命中时再问大模型（需 ANTHROPIC_API_KEY） */
export type AgentMode = "off" | "rules" | "llm";
export function agentMode(env: Env = process.env): AgentMode {
  const m = env.BOT_AGENT;
  return m === "off" || m === "llm" ? m : "rules";
}

export const CONFIRM_RE = /^(确认|确定|是的?|好的?|ok|yes|y|执行|开始|go|可以)[!！。.\s]*$/i;
export const CANCEL_RE = /^(取消|算了|不用了?|不了|不要|no|n|放弃)[!！。.\s]*$/i;

// 待确认的计费动作：按 会话+用户 保存，5 分钟有效，只保留最近一个
type Pending = { competitorId: number; name: string; days: number; expires: number };
const pending = new Map<string, Pending>();
const TTL = 5 * 60_000;
const key = (c: BotCtx) => `${c.chatId}:${c.userId}`;
export const __resetAgentState = () => pending.clear();

export function hasPending(ctx: BotCtx): boolean {
  const p = pending.get(key(ctx));
  if (p && p.expires < Date.now()) pending.delete(key(ctx));
  return pending.has(key(ctx));
}

export function cancelPending(ctx: BotCtx): Reply {
  pending.delete(key(ctx));
  return { text: "已取消。" };
}

export async function confirmPending(ctx: BotCtx): Promise<Reply> {
  const p = pending.get(key(ctx));
  pending.delete(key(ctx));
  if (!p || p.expires < Date.now()) return { text: "没有待确认的操作，或已超时。" };
  if (ctx.role !== "admin") return { text: "抓取仅管理员可用。" }; // 权限以执行时为准，而不是提议时
  const r = await ctx.backend.runCompetitor(p.competitorId, p.days);
  watchTask(r.id, ctx.chatId, ctx.sender, ctx.baseUrl);
  return { text: `已发起「${p.name}」抓取（任务 #${r.id}，近 ${p.days} 天，预估约 ${r.estimate} 次调用）。完成后我会在这里通知你。` };
}

export type NLResult = { replies: Reply[]; understood?: string; source?: Plan["source"] } | null;

export async function handleNaturalLanguage(text: string, ctx: BotCtx, deps: LlmDeps & { mode?: AgentMode } = {}): Promise<NLResult> {
  const env = deps.env ?? process.env;
  const mode = deps.mode ?? agentMode(env);
  if (mode === "off") return null;

  const catalog = listCompetitors();
  let plan: Plan | null = ruleIntent(text, catalog);
  if (!plan && mode === "llm" && llmConfigured(env)) plan = await llmPlan(text, catalog, ctx.role === "admin" ? "admin" : "member", { ...deps, env });
  if (!plan) return null;
  if (plan.clarify) return { replies: [{ text: plan.clarify }], source: plan.source };

  const replies: Reply[] = [];
  const done = new Set<string>();
  const understood: string[] = [];
  for (const call of plan.calls.slice(0, 3)) {
    const id = JSON.stringify(call);
    if (done.has(id)) continue;
    done.add(id);
    const tool = toolByName(call.tool);
    if (!tool) continue; // 模型编造的工具名：直接忽略
    const cmd = tool.toCommand(call.args);
    if ("error" in cmd) { replies.push({ text: cmd.error }); continue; }
    understood.push(describeCall(call));

    if (tool.billed) {
      // 计费动作：只"提议"，不执行。权限先校验，避免成员被引导到确认流程。
      if (ctx.role !== "admin") { replies.push({ text: "抓取会消耗 API 额度，仅管理员可发起。" }); continue; }
      const f = findCompetitor(cmd.args[0]);
      if ("error" in f) { replies.push({ text: f.error }); continue; }
      const days = Math.max(1, Math.min(365, parseInt(cmd.args[1] ?? "30", 10) || 30));
      const cfg = configForCompetitor(f.c.id, days, 3);
      const estimate = cfg ? estimateCalls(cfg) : 0;
      pending.set(key(ctx), { competitorId: f.c.id, name: f.c.name, days, expires: Date.now() + TTL });
      replies.push({ text: `即将抓取「${f.c.name}」近 ${days} 天（预估约 ${estimate} 次 API 调用）。\n回复「确认」执行，「取消」放弃（5 分钟内有效）。` });
      continue;
    }
    replies.push(await runCommand(cmd.name, cmd.args, ctx));
  }
  return { replies, understood: understood.length ? understood.join("；") : undefined, source: plan.source };
}
