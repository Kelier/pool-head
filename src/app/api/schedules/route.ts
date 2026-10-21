import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await req.json();
  const clamp = (v: unknown, d: number, lo: number, hi: number) => Math.min(Math.max(Math.round(Number(v) || d), lo), hi);
  const competitorId = Number(b.competitorId);
  if (!db().prepare("SELECT 1 FROM competitors WHERE id = ?").get(competitorId)) return NextResponse.json({ error: "竞品不存在" }, { status: 400 });
  const interval = clamp(b.intervalDays, 7, 1, 90);
  db().prepare("DELETE FROM schedules WHERE competitor_id = ?").run(competitorId); // 每个竞品一个计划
  const r = db()
    .prepare("INSERT INTO schedules(competitor_id, interval_days, window_days, max_pages, enabled, next_run_at, created_at) VALUES (?,?,?,?,1,?,?)")
    .run(competitorId, interval, clamp(b.windowDays, 30, 1, 365), clamp(b.maxPages, 3, 1, 10), Date.now() + interval * 86_400_000, Date.now());
  return NextResponse.json({ id: Number(r.lastInsertRowid) }, { status: 201 });
}
