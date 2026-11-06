import { NextResponse } from "next/server";
import { TIKHUB_KEY_REQUIRED } from "@/lib/tikhub/client";
import { parseMaxPosts } from "@/lib/validate";
import { getTask } from "@/lib/queries";
import { cancelTask, createTask, estimateCalls, budgetStatus } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const { action, maxPosts } = await req.json();
  const t = getTask(id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (action === "cancel") {
    cancelTask(id);
    return NextResponse.json({ ok: true });
  }
  if (action === "rerun") {
    let config = t.config;
    if (maxPosts !== undefined) {
      try {
        config = { ...t.config, maxPages: undefined, maxPosts: parseMaxPosts(maxPosts) };
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
      }
    }
    const estimate = estimateCalls(config);
    const { used, limit, configured } = budgetStatus();
    if (!configured) return NextResponse.json({ error: TIKHUB_KEY_REQUIRED }, { status: 503 });
    if (config.maxPages == null ? used >= limit : used + estimate > limit) return NextResponse.json({ error: `预估 ${estimate} 次调用，今日已用 ${used}/${limit}，超出预算` }, { status: 429 });
    const nid = createTask(config, { competitorId: t.competitorId, name: t.name ?? undefined, source: "rerun" });
    return NextResponse.json({ id: nid }, { status: 201 });
  }
  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
