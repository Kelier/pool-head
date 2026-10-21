import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { configFromEnv } from "@/lib/tikhub/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const c = configFromEnv();
  // 不返回 key；只返回运行参数（来自 .env，需改 .env 后重启）
  return NextResponse.json({ settings: getSettings(), runtime: { qps: c.qps, platformConcurrency: c.platformConcurrency, dailyBudget: c.dailyBudget, maxRetries: c.maxRetries, timeoutMs: c.timeoutMs } });
}

export async function PUT(req: Request) {
  try {
    return NextResponse.json({ settings: saveSettings(await req.json()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
