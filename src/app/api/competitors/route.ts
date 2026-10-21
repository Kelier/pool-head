import { NextResponse } from "next/server";
import { overview, saveCompetitor } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ competitors: overview().perCompetitor });
}

export async function POST(req: Request) {
  try {
    return NextResponse.json({ id: saveCompetitor(await req.json()) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
