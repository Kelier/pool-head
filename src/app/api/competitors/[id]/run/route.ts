import { NextResponse } from "next/server";
import { createTask, estimateCalls, budgetStatus } from "@/lib/pipeline";
import { configForCompetitor } from "@/lib/scheduler";
import { getCompetitor } from "@/lib/queries";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const c = getCompetitor(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.windowDays) || 30, 1), 365);
  const pages = Math.min(Math.max(Number(body.maxPages) || 3, 1), 10);
  const cfg = configForCompetitor(id, days, pages)!;
  const estimate = estimateCalls(cfg);
  const { used, limit } = budgetStatus();
  if (used + estimate > limit) return NextResponse.json({ error: `预估 ${estimate} 次调用，今日已用 ${used}/${limit}，超出预算`, estimate }, { status: 429 });
  return NextResponse.json({ id: createTask(cfg, { competitorId: id, name: c.name }), estimate }, { status: 201 });
}
