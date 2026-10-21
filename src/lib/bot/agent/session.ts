// 多轮上下文：按「会话:用户」存最近几轮和"最近讨论的竞品"，用来解析"它 / 刚才那个 / 那新增呢"。
// 落库而不是放内存：长连接机器人和 Web 是两个进程，重启也不该丢。
//
// 安全：这里只存【用户原话】和【我们自己生成的"理解为…"】，不存模型基于抓取数据写出的解读文字，
// 也不存任何抓取内容——否则被污染的文本会经历史再次进入带工具的规划提示词。
import { db } from "../../db";
import type { BotCtx } from "../types";

export type Turn = { u: string; a: string };
export type Last = { competitor?: string };
export type Session = { turns: Turn[]; last: Last };

const TTL = 2 * 3_600_000;
const MAX_TURNS = 6;
const key = (c: Pick<BotCtx, "chatId" | "userId">) => `${c.chatId}:${c.userId}`;

export function loadSession(ctx: Pick<BotCtx, "chatId" | "userId">): Session {
  const r = db().prepare("SELECT turns, last, updated_at FROM bot_sessions WHERE key = ?").get(key(ctx)) as { turns: string; last: string; updated_at: number } | undefined;
  if (!r || Date.now() - r.updated_at > TTL) return { turns: [], last: {} };
  try { return { turns: JSON.parse(r.turns), last: JSON.parse(r.last) }; } catch { return { turns: [], last: {} }; }
}

export function saveTurn(ctx: Pick<BotCtx, "chatId" | "userId">, user: string, understood: string, last: Last = {}) {
  const cur = loadSession(ctx);
  const turns = [...cur.turns, { u: user.slice(0, 200), a: understood.slice(0, 120) }].slice(-MAX_TURNS);
  db().prepare(
    `INSERT INTO bot_sessions(key, turns, last, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET turns = excluded.turns, last = excluded.last, updated_at = excluded.updated_at`,
  ).run(key(ctx), JSON.stringify(turns), JSON.stringify({ ...cur.last, ...last }), Date.now());
}

export const __resetSessions = () => void db().prepare("DELETE FROM bot_sessions").run();
