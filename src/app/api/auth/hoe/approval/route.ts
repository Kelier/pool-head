import { NextRequest, NextResponse } from "next/server";
import { APPROVAL_COOKIE, APPROVED_SESSION_COOKIE, pendingApproval, redeemApproval } from "@/lib/auth/approval";
import { authOrigin, authorizeUrl, CALLBACK_COOKIE_SECONDS, CALLBACK_PATH, OAUTH_COOKIE, returnPath } from "@/lib/auth/feishu";
import { usesHoeApproval } from "@/lib/auth/hoe";
import { randomToken, SESSION_SECONDS } from "@/lib/auth/store";

/** 飞书私信中的链接只启动飞书身份验证，不能签发浏览器登录会话。 */
export async function GET(request: NextRequest) {
  if (!usesHoeApproval()) return new NextResponse(null, { status: 404 });
  const origin = authOrigin();
  const approval = request.nextUrl.searchParams.get("token");
  if (!approval || !pendingApproval(approval)) return NextResponse.redirect(new URL("/login?approval=expired", origin), 303);

  try {
    const state = randomToken();
    const verifier = randomToken();
    const response = NextResponse.redirect(await authorizeUrl(state, verifier), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, approval }), {
      httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax", path: CALLBACK_PATH, maxAge: CALLBACK_COOKIE_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=approvalService", origin), 303);
  }
}

/** 原登录浏览器提交审批状态，成功后发放本站会话。 */
export async function POST(request: NextRequest) {
  if (!usesHoeApproval()) return new NextResponse(null, { status: 404 });
  const origin = authOrigin();
  if (request.headers.get("origin") !== origin.origin) return new NextResponse(null, { status: 403 });
  const result = redeemApproval(request.cookies.get(APPROVAL_COOKIE)?.value);
  const secure = origin.protocol === "https:";
  const next = result.status === "approved" ? returnPath(result.next) : `/login?approval=${result.status}`;
  const response = NextResponse.redirect(new URL(next, origin), 303);
  response.headers.set("Cache-Control", "no-store");
  if (result.status !== "pending") {
    response.cookies.set(APPROVAL_COOKIE, "", { path: "/api/auth/hoe/approval", httpOnly: true, secure, sameSite: "lax", maxAge: 0 });
  }
  if (result.status === "approved") {
    response.cookies.set(APPROVED_SESSION_COOKIE, result.session, { path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: SESSION_SECONDS });
  }
  return response;
}
