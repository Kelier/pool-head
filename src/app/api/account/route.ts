import { NextResponse } from "next/server";
import { accountDetail, saveAccountMeta } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const d = accountDetail(sp.get("platform") ?? "", sp.get("uid") ?? "");
  return d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: Request) {
  const b = await req.json();
  try {
    saveAccountMeta(String(b.platform), String(b.uid), { status: b.status, tags: b.tags, note: b.note });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
