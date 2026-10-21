"use client";
import type { Progress, TaskConfig } from "@/lib/types";
import { PLATFORM_NAME } from "@/lib/consts";

export type TaskT = {
  id: number; name: string | null; status: string; error: string | null; source: string; scope: string;
  competitorId: number | null; competitorName: string | null; competitorColor: string | null; scheduleId: number | null;
  config: TaskConfig; progress: Progress; createdAt: number; finishedAt: number | null;
};
export type TasksResp = { total: number; rows: TaskT[]; page: number; pageSize: number; budget: { used: number; limit: number } };
export type CompetitorLite = { id: number; name: string; color: string; keywords: string[]; platforms: string[] };

export const isLive = (s: string) => s === "running" || s === "pending";

export function rangeText(c: TaskConfig) {
  return c.time.type === "relative" ? `近 ${c.time.days} 天` : `${c.time.from} ~ ${c.time.to}`;
}

export function durationText(t: TaskT) {
  if (isLive(t.status)) return "进行中";
  if (!t.finishedAt) return "—";
  const s = Math.max(0, Math.round((t.finishedAt - t.createdAt) / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function platformText(c: TaskConfig) {
  return c.platforms.map((p) => PLATFORM_NAME[p] ?? p).join("、");
}

export function taskTitle(t: Pick<TaskT, "id" | "name">) {
  return t.name || `任务 #${t.id}`;
}
