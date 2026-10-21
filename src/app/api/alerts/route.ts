import { NextResponse } from "next/server";
import { listAlerts, markAlertsRead } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listAlerts(100));
}
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  markAlertsRead(Array.isArray(b.ids) ? b.ids.map(Number) : undefined);
  return NextResponse.json({ ok: true });
}
