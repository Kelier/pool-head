import { NextResponse } from "next/server";
import { compareCompetitors, compareTasks } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("type") === "competitors") {
      return NextResponse.json(compareCompetitors((sp.get("ids") ?? "").split(",").map(Number).filter(Boolean)));
    }
    return NextResponse.json(compareTasks(Number(sp.get("a")), Number(sp.get("b"))));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
