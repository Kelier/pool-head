// 待确认的操作（抓取、新增竞品、改监测词、标记账号…）。按 会话+用户 保存，5 分钟有效，只保留最近一个。
// 落库：确认发生在重启之后也不会丢；权限在【执行时】再校验（见 engine.confirmPending）。
import { db } from "../../db";
import type { BotCtx } from "../types";

export type PendingAction = { kind: string; payload: Record<string, unknown>; summary: string };

export const TTL = 5 * 60_000;
const key = (c: Pick<BotCtx, "chatId" | "userId">) => `${c.chatId}:${c.userId}`;

export function setPending(ctx: Pick<BotCtx, "chatId" | "userId">, a: PendingAction) {
  db().prepare(
    `INSERT INTO bot_pending(key, kind, payload, summary, expires) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, summary = excluded.summary, expires = excluded.expires`,
  ).run(key(ctx), a.kind, JSON.stringify(a.payload), a.summary, Date.now() + TTL);
}

/** 取出并删除（确认只能用一次）；过期视为没有。 */
export function takePending(ctx: Pick<BotCtx, "chatId" | "userId">): PendingAction | null {
  const r = db().prepare("SELECT kind, payload, summary, expires FROM bot_pending WHERE key = ?").get(key(ctx)) as { kind: string; payload: string; summary: string; expires: number } | undefined;
  db().prepare("DELETE FROM bot_pending WHERE key = ?").run(key(ctx));
  if (!r || r.expires < Date.now()) return null;
  return { kind: r.kind, payload: JSON.parse(r.payload), summary: r.summary };
}

export function hasPendingAction(ctx: Pick<BotCtx, "chatId" | "userId">): boolean {
  const r = db().prepare("SELECT expires FROM bot_pending WHERE key = ?").get(key(ctx)) as { expires: number } | undefined;
  if (r && r.expires < Date.now()) db().prepare("DELETE FROM bot_pending WHERE key = ?").run(key(ctx));
  return !!r && r.expires >= Date.now();
}

export const __resetPending = () => void db().prepare("DELETE FROM bot_pending").run();
