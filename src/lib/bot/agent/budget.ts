// 大模型用量与额度：落库（重启不丢、长连接进程与 Web 进程共享），按天按人统计调用数与 token。
//   BOT_LLM_DAILY_CAP        全员每日调用上限（默认 200，规划与解读各算一次）
//   BOT_LLM_USER_DAILY_CAP   每人每日调用上限（默认 40）
//   BOT_LLM_DAILY_TOKENS     全员每日 token 上限（输入+输出，默认 1,000,000；0 = 不限）
import { db } from "../../db";

type Env = Record<string, string | undefined>;

const dayKey = () => new Date().toLocaleDateString("sv-SE");
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export const __resetLlmBudget = () => void db().prepare("DELETE FROM bot_llm_usage").run();

export type Refusal = { scope: "global" | "user"; message: string };

/** 额度够就占用一次调用并返回 null；不够返回拒绝原因（不发请求）。 */
export function reserveCall(env: Env, userId: string): Refusal | null {
  const d = dayKey();
  const row = db().prepare("SELECT COALESCE(SUM(calls),0) calls, COALESCE(SUM(tokens_in+tokens_out),0) tokens FROM bot_llm_usage WHERE day = ?").get(d) as { calls: number; tokens: number };
  const mine = db().prepare("SELECT calls FROM bot_llm_usage WHERE day = ? AND user_id = ?").get(d, userId) as { calls: number } | undefined;
  const tokenCap = num(env.BOT_LLM_DAILY_TOKENS, 1_000_000);
  if (row.calls >= num(env.BOT_LLM_DAILY_CAP, 200) || (tokenCap > 0 && row.tokens >= tokenCap)) {
    return { scope: "global", message: "今天的智能解析额度已用完，请直接用指令（发送「帮助」查看）。" };
  }
  const userCap = num(env.BOT_LLM_USER_DAILY_CAP, 40);
  if ((mine?.calls ?? 0) >= userCap) return { scope: "user", message: `你今天的智能问答次数已用完（每人每天 ${userCap} 次），可以继续使用指令，明天再来。` };
  db().prepare(
    `INSERT INTO bot_llm_usage(day, user_id, calls) VALUES (?, ?, 1)
     ON CONFLICT(day, user_id) DO UPDATE SET calls = calls + 1`,
  ).run(d, userId);
  return null;
}

/** 请求返回后补记 token（失败的请求没有 usage，只占了次数）。cacheHit：命中缓存的输入 token（DeepSeek 等返回）。 */
export function addTokens(userId: string, tokensIn: number, tokensOut: number, cacheHit = 0) {
  db().prepare("UPDATE bot_llm_usage SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cache_hit = cache_hit + ? WHERE day = ? AND user_id = ?")
    .run(Math.max(0, tokensIn | 0), Math.max(0, tokensOut | 0), Math.max(0, cacheHit | 0), dayKey(), userId);
}

export function llmUsageToday() {
  const r = db().prepare("SELECT COALESCE(SUM(calls),0) calls, COALESCE(SUM(tokens_in),0) tokensIn, COALESCE(SUM(tokens_out),0) tokensOut, COALESCE(SUM(cache_hit),0) cacheHit, COUNT(*) users FROM bot_llm_usage WHERE day = ?").get(dayKey()) as
    { calls: number; tokensIn: number; tokensOut: number; cacheHit: number; users: number };
  return r;
}
