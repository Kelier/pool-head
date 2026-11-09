import { NextRequest, NextResponse } from "next/server";
import { authOrigin } from "@/lib/auth/feishu";
import { hoeClient, usesHoeApproval, usesHoeAuth } from "@/lib/auth/hoe";
import { APPROVED_SESSION_COOKIE, revokeApprovedSession } from "@/lib/auth/approval";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/store";

/** 撤销当前会话后清除浏览器凭证。 */
export async function POST(request: NextRequest) {
  const origin = authOrigin();
  const response = NextResponse.redirect(new URL("/login", origin), 303);
  response.headers.set("Cache-Control", "no-store");
  try {
    if (usesHoeApproval()) {
      revokeApprovedSession(request.cookies.get(APPROVED_SESSION_COOKIE)?.value);
      response.cookies.set(APPROVED_SESSION_COOKIE, "", { path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax", maxAge: 0 });
      return response;
    }
    if (usesHoeAuth()) {
      const { error } = await hoeClient(request, response).auth.signOut({ scope: "local" });
      if (error) throw error;
      return response;
    }
    await revokeSession(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    return NextResponse.json({ error: "暂时无法退出，请稍后再试。" }, { status: 503 });
  }
  response.cookies.set(SESSION_COOKIE, "", { path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax", maxAge: 0 });
  return response;
}
