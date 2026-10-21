import { NextResponse } from "next/server";
import { flagPost } from "@/lib/queries";

export const runtime = "nodejs";

// 人工校正：verdict=rejected 表示"这不是投放内容"（全局生效，计数会扣除）；auto 恢复
export async function POST(req: Request) {
  const b = await req.json();
  if (!["rejected", "auto"].includes(b.verdict)) return NextResponse.json({ error: "非法 verdict" }, { status: 400 });
  flagPost(String(b.platform), String(b.postId), b.verdict);
  return NextResponse.json({ ok: true });
}
