import { NextResponse } from "next/server";
import { usage } from "@/lib/queries";
import { budgetStatus } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...usage(), budget: budgetStatus() });
}
