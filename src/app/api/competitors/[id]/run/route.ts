import { NextResponse } from "next/server";
import { TIKHUB_KEY_REQUIRED } from "@/lib/tikhub/client";
import { createTask, estimateCalls, budgetStatus } from "@/lib/pipeline";
import { configForCompetitor } from "@/lib/scheduler";
import { getCompetitor } from "@/lib/queries";

import { MAX_SEARCH_PAGES } from "@/lib/search-pages";
import { isValidDateRange } from "@/lib/dates";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const c = getCompetitor(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.windowDays) || 30, 1), 365);
  const pages = Number(body.maxPages) || undefined;
  if (pages !== undefined && (!Number.isInteger(pages) || pages < 1 || pages > MAX_SEARCH_PAGES)) {
    return NextResponse.json({ error: `翻页数须在 1–${MAX_SEARCH_PAGES} 之间` }, { status: 400 });
  }
  const time = body?.time;
  if (time !== undefined && (time?.type !== "absolute" || !isValidDateRange(time.from, time.to))) {
    return NextResponse.json({ error: "绝对时间范围不合法" }, { status: 400 });
  }
  const cfg = configForCompetitor(id, time ?? days, pages)!;
  const estimate = estimateCalls(cfg);
  const { used, limit, configured } = budgetStatus();
  if (!configured) return NextResponse.json({ error: TIKHUB_KEY_REQUIRED }, { status: 503 });
  if (cfg.maxPages == null ? used >= limit : used + estimate > limit) return NextResponse.json({ error: `预估 ${estimate} 次调用，今日已用 ${used}/${limit}，超出预算`, estimate }, { status: 429 });
  return NextResponse.json({ id: createTask(cfg, { competitorId: id, name: c.name }), estimate }, { status: 201 });
}
