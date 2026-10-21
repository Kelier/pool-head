import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/queries";
import { parseAccountFilter } from "@/lib/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json(listAccounts(parseAccountFilter(new URL(req.url).searchParams)));
}
