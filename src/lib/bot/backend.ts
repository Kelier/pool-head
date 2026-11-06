import { createTask, estimateCalls, budgetStatus } from "../pipeline";
import { configForCompetitor } from "../scheduler";
import { TIKHUB_KEY_REQUIRED } from "../tikhub/client";
import { getCompetitor } from "../queries";
import type { BotBackend } from "./types";

/** 进程内：机器人跑在 Web 应用同一进程里（webhook 模式）。 */
export const directBackend: BotBackend = {
  async runCompetitor(id, days, absolute) {
    const c = getCompetitor(id);
    if (!c) throw new Error("竞品不存在");
    const cfg = configForCompetitor(id, absolute ?? days)!;
    const estimate = estimateCalls(cfg);
    const { used, limit, configured } = budgetStatus();
    if (!configured) throw new Error(TIKHUB_KEY_REQUIRED);
    if (cfg.maxPages == null ? used >= limit : used + estimate > limit) throw new Error(`预估 ${estimate} 次调用，今日已用 ${used}/${limit}，超出预算`);
    return { id: createTask(cfg, { competitorId: id, name: c.name }), estimate };
  },
};

/**
 * 跨进程：机器人是独立进程（长连接模式）。写操作转给 Web 应用的 HTTP 接口，
 * 这样 TikHub 的限速/熔断/预算只在 Web 进程里维护一份，不会因为多开进程而翻倍。
 */
export function httpBackend(baseUrl: string): BotBackend {
  return {
    async runCompetitor(id, days, absolute) {
      const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/competitors/${id}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bot-Backend-Secret": process.env.BOT_BACKEND_SECRET ?? "",
        },
        body: JSON.stringify({ windowDays: days, time: absolute }),
      }).catch(() => { throw new Error(`连不上 Web 应用（${baseUrl}），请确认它已启动，或检查 APP_BASE_URL`); });
      const j = (await r.json().catch(() => ({}))) as { id?: number; estimate?: number; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `Web 应用返回 ${r.status}`);
      return { id: j.id, estimate: j.estimate ?? 0 };
    },
  };
}
