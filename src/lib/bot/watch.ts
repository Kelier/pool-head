// 异步通知：任务完成后推送结果；系统提醒推送给已订阅的会话。
import { db } from "../db";
import { getTask } from "../queries";
import { listAlerts } from "../alerts";
import { card, link } from "./cards";
import type { Sender } from "./types";

const LIVE = new Set(["pending", "running"]);

/** 轮询 DB（两个进程共用同一个 SQLite），任务结束就推一张结果卡片；最长等 20 分钟。 */
export function watchTask(taskId: number, chatId: string, sender: Sender, baseUrl: string, opts: { intervalMs?: number; maxMs?: number } = {}) {
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const t = getTask(taskId);
      if (t && LIVE.has(t.status) && Date.now() - started < (opts.maxMs ?? 20 * 60_000)) return;
      clearInterval(timer);
      if (!t) return;
      const p = t.progress;
      const ok = t.status === "done";
      await sender.card(chatId, card(`任务 #${t.id} ${ok ? "已完成" : "未完成"}`, ok ? "green" : "red", [
        ok ? `**${t.name ?? ""}**：命中 ${p.accounts ?? 0} 个账号（新增 ${p.newAccounts ?? 0}，高频复投 ${p.repeatAccounts ?? 0}）` : `**${t.name ?? ""}**：${t.error ?? t.status}`,
        link("查看详情", `${baseUrl.replace(/\/$/, "")}/tasks/${t.id}`),
      ]));
    } catch (e) {
      console.error("[bot] watchTask", e);
    }
  }, opts.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}

const KEY = "bot_last_alert_id";
const getLast = () => Number((db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined)?.value ?? NaN);
const setLast = (id: number) => db().prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, String(id));

/** 把新的系统提醒推送给订阅会话。首次启动只记录水位，不回放历史。 */
export async function pushAlertsOnce(sender: Sender, baseUrl: string) {
  const items = listAlerts(50).items as Array<{ id: number; type: string; title: string; body: string | null; href: string | null }>;
  const max = items.reduce((m, a) => Math.max(m, a.id), 0);
  const last = getLast();
  if (Number.isNaN(last)) return setLast(max);
  const fresh = items.filter((a) => a.id > last).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  const chats = (db().prepare("SELECT chat_id FROM bot_subs").all() as Array<{ chat_id: string }>).map((r) => r.chat_id);
  for (const a of fresh) {
    const tpl = a.type === "task_failed" ? "red" : a.type === "new_repeat" ? "orange" : a.type === "budget" ? "yellow" : "green";
    for (const c of chats) {
      await sender.card(c, card(a.title, tpl, [a.body ?? "", a.href ? link("查看", `${baseUrl.replace(/\/$/, "")}${a.href}`) : ""])).catch((e) => console.error("[bot] push", e));
    }
  }
  setLast(max);
}

export function startAlertPusher(sender: Sender, baseUrl: string, intervalMs = 30_000) {
  const timer = setInterval(() => pushAlertsOnce(sender, baseUrl).catch((e) => console.error("[bot] pusher", e)), intervalMs);
  timer.unref?.();
  void pushAlertsOnce(sender, baseUrl).catch(() => {});
  return () => clearInterval(timer);
}
