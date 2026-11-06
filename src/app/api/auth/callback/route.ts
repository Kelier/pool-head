import { NextRequest, NextResponse } from "next/server";
import { approveLogin } from "@/lib/auth/approval";
import { usesHoeApproval, usesHoeAuth } from "@/lib/auth/hoe";
import { authOrigin, CALLBACK_PATH, exchangeIdentity, OAUTH_COOKIE, returnPath } from "@/lib/auth/feishu";
import { createSession, SESSION_COOKIE, SESSION_SECONDS, TOKEN_PATTERN } from "@/lib/auth/store";

/** 验证本次回调，只有飞书身份和账号库均确认成功才发放会话。 */
export async function GET(request: NextRequest) {
  if (usesHoeAuth() && !usesHoeApproval()) return new NextResponse(null, { status: 404 });
  const origin = authOrigin();
  const secure = origin.protocol === "https:";
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(OAUTH_COOKIE, "", { path: CALLBACK_PATH, httpOnly: true, secure, sameSite: "lax", maxAge: 0 });
    return response;
  };

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const raw = request.cookies.get(OAUTH_COOKIE)?.value;
    if (!code || !state || !raw) return finish("/login?error=authorization");
    const oauth = JSON.parse(raw) as { state?: string; verifier?: string; next?: string; approval?: string };
    if (oauth.state !== state || !oauth.verifier || !TOKEN_PATTERN.test(oauth.verifier)) return finish("/login?error=authorization");

    const identity = await exchangeIdentity(code, oauth.verifier);
    if (!identity) return finish("/login?error=tenant");
    if (usesHoeApproval()) {
      if (!oauth.approval || !approveLogin(oauth.approval, identity)) return finish("/login?error=approvalIdentity");
      return finish("/login?approval=confirmed");
    }
    const session = await createSession(identity);
    const response = finish(returnPath(oauth.next));
    response.cookies.set(SESSION_COOKIE, session, { path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: SESSION_SECONDS });
    return response;
  } catch (error) {
    console.error("[web-auth] 飞书登录失败", error instanceof Error ? error.message : "");
    return finish("/login?error=service");
  }
}
