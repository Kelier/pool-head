// 进程内定时监控：每分钟检查到期的 schedules 并创建任务。线上换 Vercel Cron / 队列。
import { db } from "./db";
import { createTask, budgetStatus } from "./pipeline";
import { getCompetitor } from "./queries";
import { addAlert } from "./alerts";
import type { Platform, TaskConfig, TimeRange } from "./types";
import { getSettings } from "./settings";

const DAY = 86_400_000;

/** 复用竞品配置生成抓取任务，兼容定时任务的相对天数。 */
export function configForCompetitor(competitorId: number, time: number | TimeRange, maxPages?: number): TaskConfig | null {
  const c = getCompetitor(competitorId);
  if (!c) return null;
  const s = getSettings();
  return {
    platforms: c.platforms as Platform[], keywords: c.keywords, match: "any", time: typeof time === "number" ? { type: "relative", days: time } : time,
    repeatThreshold: s.repeatThreshold, maxPages, minConfidence: s.minConfidence,
  };
}

export function runDueSchedules(now = Date.now()) {
  const due = db().prepare("SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ?").all(now) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const s of due) {
    const cfg = configForCompetitor(s.competitor_id, s.window_days, s.max_pages || undefined);
    // 无论成功与否都推进 next_run_at，避免失败后每分钟重试把预算打爆
    db().prepare("UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?").run(now, now + s.interval_days * DAY, s.id);
    if (!cfg) continue;
    const { used, limit, configured } = budgetStatus();
    if (!configured) {
      addAlert("schedule", "定时监控已跳过：缺少 TIKHUB_API_KEY", `竞品 #${s.competitor_id}`, "/settings");
      continue;
    }
    if (used >= limit) {
      addAlert("schedule", "定时监控已跳过：今日调用预算已用完", `竞品 #${s.competitor_id}`, "/settings");
      continue;
    }
    createTask(cfg, { competitorId: s.competitor_id, name: getCompetitor(s.competitor_id)?.name, source: "schedule", scheduleId: s.id });
  }
  return due.length;
}

const g = globalThis as unknown as { __sched?: NodeJS.Timeout };
export function startScheduler() {
  if (g.__sched) return;
  g.__sched = setInterval(() => {
    try { runDueSchedules(); } catch (e) { console.error("[scheduler]", e); }
  }, 60_000);
  g.__sched.unref?.();
}
