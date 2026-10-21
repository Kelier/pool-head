import { NextResponse } from "next/server";
import { accountRows, deleteTask, getTask, summarize, weeklyTrend } from "@/lib/queries";
import { parseAccountFilter } from "@/lib/params";
import { cancelTask } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  const f = { ...parseAccountFilter(new URL(req.url).searchParams), taskId: id, n: task.config.repeatThreshold };
  const base = accountRows({ taskId: id, n: task.config.repeatThreshold });
  const rows = accountRows(f);
  const pageSize = Math.min(f.pageSize ?? 50, 500), page = Math.max(f.page ?? 1, 1);
  return NextResponse.json({
    task, summary: summarize(base), trend: weeklyTrend({ taskId: id }, 12),
    total: rows.length, rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
  });
}

export async function DELETE(_: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const t = getTask(id);
  if (t && (t.status === "running" || t.status === "pending")) cancelTask(id);
  deleteTask(id);
  return NextResponse.json({ ok: true });
}
