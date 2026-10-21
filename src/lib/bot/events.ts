// 事件适配：飞书 im.message.receive_v1 → 指令层 → 回复。长连接与 webhook 两种接入方式共用。
import { roleOf, RateLimiter } from "./auth";
import { dispatch, parseCommand, cleanText, findCommand, ALL_COMMANDS, type IntentResolver } from "./commands";
import { cancelPending, CANCEL_RE, CONFIRM_RE, confirmPending, handleNaturalLanguage, hasPending } from "./agent";
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
  resolve?: IntentResolver;
  /** 测试注入：大模型请求所用的 fetch */
  llmFetch?: typeof fetch;
};

// 进程级共享状态：事件去重（飞书会重试）、限流
const seen = new Map<string, number>();
const general = new RateLimiter(20, 60_000);
const expensive = new RateLimiter(5, 3_600_000);
const agentLimit = new RateLimiter(10, 60_000); // 意图层（可能调用大模型）每人每分钟 10 次
/** 仅测试用：清空去重与限流状态 */
export const __resetBotState = () => { seen.clear(); general.reset(); expensive.reset(); agentLimit.reset(); };

const EXPENSIVE = new Set(ALL_COMMANDS.filter((c) => c.names[0] === "抓取").flatMap((c) => c.names));

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
  if (m.message_type !== "text") return reply("目前只支持文字指令，发送「帮助」查看。");
  if (!general.allow(userId)) return reply("请求太频繁了，稍后再试。");

  let text = "";
  try { text = (JSON.parse(m.content) as { text?: string }).text ?? ""; } catch { return reply("消息格式无法识别。"); }
  const parsed = parseCommand(text);
  if (parsed && EXPENSIVE.has(parsed.name) && role === "admin" && !expensive.allow(userId)) return reply("抓取次数过多（每人每小时最多 5 次），请稍后再试。");

  const ctx: BotCtx = {
    userId, chatId: m.chat_id, chatType: m.chat_type, role, sender: deps.sender, backend: deps.backend,
    baseUrl: env.APP_PUBLIC_URL || "http://localhost:3111",
  };
  try {
    // 不是已知指令 → 意图层：确认/取消待办 → 自然语言解析（规则优先，其次大模型）→ 复用现有指令
    if (!(parsed && findCommand(parsed.name))) {
      const clean = cleanText(text);
      const confirm = CONFIRM_RE.test(clean), cancel = CANCEL_RE.test(clean);
      if (confirm || cancel) {
        if (!hasPending(ctx)) return reply("没有待确认的操作。");
        if (cancel) return reply(cancelPending(ctx).text!);
        if (!expensive.allow(userId)) return reply("抓取次数过多（每人每小时最多 5 次），请稍后再试。");
        return reply((await confirmPending(ctx)).text!);
      }
      if (agentLimit.allow(userId)) {
        const nl = await handleNaturalLanguage(clean, ctx, { env, fetch: deps.llmFetch });
        if (nl) {
          if (nl.understood) await reply(`🤖 理解为：${nl.understood}`);
          for (const r of nl.replies) {
            if (r.card) await deps.sender.card(m.chat_id, r.card, m.message_id);
            if (r.file) await deps.sender.file(m.chat_id, r.file.name, r.file.data, m.message_id);
            if (r.text) await reply(r.text);
          }
          return;
        }
      } else return reply("请求太频繁了，稍后再试。");
    }
    const r = await dispatch(text, ctx, deps.resolve);
    if (r.card) await deps.sender.card(m.chat_id, r.card, m.message_id);
    if (r.file) await deps.sender.file(m.chat_id, r.file.name, r.file.data, m.message_id);
    if (r.text) await reply(r.text);
  } catch (e) {
    console.error("[bot] dispatch", e);
    await reply(`出错了：${(e as Error).message}`).catch(() => {});
  }
}
