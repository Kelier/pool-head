// 事件适配：飞书 im.message.receive_v1 → 意图层 → 回复。长连接与 webhook 两种接入方式共用。
import { roleOf, RateLimiter } from "./auth";
import { cleanText } from "./commands";
import { agentMode, cancelPending, CANCEL_RE, CONFIRM_RE, confirmPending, handleNaturalLanguage, hasPending, hasIntentDraft, ProgressCard } from "./agent";
import { handleNpr, type NprRunner } from "./npr";
import { card } from "./cards";
import type { BotBackend, BotCtx, Sender } from "./types";

type Env = Record<string, string | undefined>;

export type MessageEvent = {
  sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  message?: {
    message_id: string; chat_id: string; chat_type: "p2p" | "group"; message_type: string; content: string;
    mentions?: Array<{ key: string; id?: { open_id?: string }; name?: string }>;
  };
};

export type EventDeps = {
  sender: Sender;
  backend: BotBackend;
  env?: Env;
  /** 机器人自己的 open_id（用于判断群里是否 @ 了它）；返回 null 则"任何 @ 都算" */
  botOpenId?: () => Promise<string | null>;
  /** 测试注入：大模型请求所用的 fetch */
  llmFetch?: typeof fetch;
  /** 仅本机长连接注入的 PR 审批执行器。 */
  nprRunner?: NprRunner;
};

// 进程级共享状态：事件去重（飞书会重试）、限流
const seen = new Map<string, number>();
const general = new RateLimiter(20, 60_000);
const expensive = new RateLimiter(5, 3_600_000);
const agentLimit = new RateLimiter(10, 60_000); // 意图层（可能调用大模型）每人每分钟 10 次
/** 仅测试用：清空去重与限流状态 */
export const __resetBotState = () => { seen.clear(); general.reset(); expensive.reset(); agentLimit.reset(); };

function firstSeen(id: string): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60_000) seen.delete(k);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

export async function handleMessageEvent(ev: MessageEvent, deps: EventDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const m = ev.message;
  const userId = ev.sender?.sender_id?.open_id;
  if (!m || !userId || ev.sender?.sender_type === "app") return;
  if (!firstSeen(m.message_id)) return;

  // 群聊只在被 @ 时响应，避免刷屏
  if (m.chat_type === "group") {
    const bot = deps.botOpenId ? await deps.botOpenId() : null;
    const mentioned = bot ? m.mentions?.some((x) => x.id?.open_id === bot) : (m.mentions?.length ?? 0) > 0;
    if (!mentioned) return;
  }

  const reply = (text: string) => deps.sender.text(m.chat_id, text, m.message_id);
  const role = roleOf(userId, m.chat_id, env);
  if (role === "none") {
    // 默认拒绝，但告诉对方自己的 open_id，方便管理员授权
    return reply(`你还没有使用权限。\n你的 open_id：${userId}\n请把它发给管理员，加入 FEISHU_ALLOWED_USERS（只读）或 FEISHU_ADMIN_OPEN_IDS（可抓取）。`);
  }
  if (m.message_type !== "text") return reply("目前只支持文字消息，发送「帮助」查看。");
  if (!general.allow(userId)) return reply("请求太频繁了，稍后再试。");

  let text = "";
  try { text = (JSON.parse(m.content) as { text?: string }).text ?? ""; } catch { return reply("消息格式无法识别。"); }
  if (typeof text !== "string") return reply("消息格式无法识别。");
  const original = text.trim();
  if (/^npr(?:\s|$)/i.test(original)) {
    return reply(await handleNpr(original, userId, m.chat_type === "p2p", env, deps.nprRunner));
  }
  if (agentMode(env) === "off") return reply("自然语言处理已关闭，目前无法处理消息。");
  // 旧写法也作为普通文本解析，不再因为斜杠跳过意图层或确认。
  const clean = cleanText(text).replace(/^[/／]+\s*/, "");
  const ctx: BotCtx = {
    userId, chatId: m.chat_id, chatType: m.chat_type, role, sender: deps.sender, backend: deps.backend,
    baseUrl: env.APP_PUBLIC_URL || "http://localhost:3111",
  };
  let progress: ProgressCard | undefined;
  try {
    const confirm = CONFIRM_RE.test(clean), cancel = CANCEL_RE.test(clean);
    if (confirm || cancel) {
      if (!hasPending(ctx) && !(cancel && hasIntentDraft(ctx))) return reply("没有待确认的操作。");
      if (cancel) return reply(cancelPending(ctx).text!);
      if (!expensive.allow(userId)) return reply("操作次数过多（每人每小时最多确认 5 次），请稍后再试。");
      return reply((await confirmPending(ctx)).text!);
    }
    if (!agentLimit.allow(userId)) return reply("请求太频繁了，稍后再试。");

    progress = new ProgressCard(deps.sender, m.chat_id, m.message_id);
    const nl = await handleNaturalLanguage(clean, ctx, { env, fetch: deps.llmFetch, progress });
    if (!nl) {
      const message = "我没听懂，这条消息暂时处理不了。可以说「你能做什么」查看示例。";
      if (!(await progress.finish(card("🤖 回复", "grey", [message], { updatable: true })))) await reply(message);
      return;
    }

    const head = nl.understood ? `🤖 理解为：${nl.understood}` : "";
    const body = [nl.analysis, nl.note].filter(Boolean).join("\n");
    const replies = [...nl.replies];
    if (progress.active) {
      const text0 = !head && !body && replies[0]?.text && !replies[0].card && !replies[0].file ? replies[0].text : "";
      const done = await progress.finish(card(head || "🤖 回复", "violet", [body || text0 || "结果见下方。"], { updatable: true }));
      if (done && text0) replies.shift();
      if (!done) {
        if (head) await reply(head);
        if (body) await deps.sender.card(m.chat_id, card("📝 解读", "violet", [body]), m.message_id);
      }
    } else {
      if (head) await reply(head);
      if (body) await deps.sender.card(m.chat_id, card("📝 解读", "violet", [body]), m.message_id);
    }
    for (const r of replies) {
      if (r.card) await deps.sender.card(m.chat_id, r.card, m.message_id);
      if (r.file) await deps.sender.file(m.chat_id, r.file.name, r.file.data, m.message_id);
      if (r.text) await reply(r.text);
    }
  } catch (e) {
    console.error("[bot] handle message", e);
    const msg = `出错了：${(e as Error).message}`;
    if (!(await progress?.finish(card("🤖 出错了", "red", [msg], { updatable: true })))) await reply(msg).catch(() => {});
  }
}
