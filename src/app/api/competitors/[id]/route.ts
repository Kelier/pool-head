import { NextResponse } from "next/server";
import { accountRows, deleteCompetitor, getCompetitor, listTasks, saveCompetitor, summarize, weeklyTrend } from "@/lib/queries";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const competitor = getCompetitor(id);
  if (!competitor) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = accountRows({ competitorId: id });
  const schedule = db().prepare("SELECT * FROM schedules WHERE competitor_id = ? ORDER BY id DESC LIMIT 1").get(id) ?? null;
  return NextResponse.json({
    competitor, summary: summarize(rows), trend: weeklyTrend({ competitorId: id }, 12),
    tasks: listTasks({ competitorId: id, pageSize: 10 }).rows, schedule, topAccounts: rows.slice(0, 10),
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  try {
    saveCompetitor(await req.json(), id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: Request, ctx: Ctx) {
  deleteCompetitor(Number((await ctx.params).id));
  return NextResponse.json({ ok: true });
}
