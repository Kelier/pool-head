import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const b = await req.json();
  if (typeof b.enabled === "boolean") db().prepare("UPDATE schedules SET enabled = ? WHERE id = ?").run(b.enabled ? 1 : 0, id);
  return NextResponse.json({ ok: true });
}
export async function DELETE(_: Request, ctx: Ctx) {
  db().prepare("DELETE FROM schedules WHERE id = ?").run(Number((await ctx.params).id));
  return NextResponse.json({ ok: true });
}
