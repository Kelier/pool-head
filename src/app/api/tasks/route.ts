import { NextResponse } from "next/server";
import { createTask, estimateCalls, budgetStatus } from "@/lib/pipeline";
import { getCompetitor, listTasks } from "@/lib/queries";
import { parseTaskConfig } from "@/lib/validate";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const n = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return NextResponse.json({
    ...listTasks({ competitorId: n("competitor"), status: sp.get("status") || undefined, q: sp.get("q") || undefined, page: n("page"), pageSize: n("pageSize") }),
    budget: budgetStatus(),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const competitorId = body.competitorId ? Number(body.competitorId) : null;
  const comp = competitorId ? getCompetitor(competitorId) : null;
  if (competitorId && !comp) return NextResponse.json({ error: "竞品不存在" }, { status: 400 });
  let cfg;
  try {
    const s = getSettings();
    cfg = parseTaskConfig({
      repeatThreshold: s.repeatThreshold, minConfidence: s.minConfidence,
      ...body,
      platforms: body.platforms?.length ? body.platforms : comp?.platforms,
      keywords: body.keywords?.length ? body.keywords : comp?.keywords,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const estimate = estimateCalls(cfg);
  const { used, limit } = budgetStatus();
  if (used + estimate > limit) return NextResponse.json({ error: `预估 ${estimate} 次调用，今日已用 ${used}/${limit}，超出预算`, estimate }, { status: 429 });
  const name = body.name || comp?.name || cfg.keywords.slice(0, 3).join("、");
  return NextResponse.json({ id: createTask(cfg, { competitorId, name }), estimate }, { status: 201 });
}
