import { NextResponse } from "next/server";
import { overview } from "@/lib/queries";
import { budgetStatus } from "@/lib/pipeline";
import { listAlerts } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...overview(), budget: budgetStatus(), unread: listAlerts(1).unread });
}
