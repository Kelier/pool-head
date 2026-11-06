import { NextRequest, NextResponse } from "next/server";
import { localAdminOnly } from "@/lib/auth/local-admin";
import { usesHoeAuth } from "@/lib/auth/hoe";
import { authOrigin, authorizeUrl, CALLBACK_COOKIE_SECONDS, CALLBACK_PATH, OAUTH_COOKIE, returnPath } from "@/lib/auth/feishu";
import { randomToken } from "@/lib/auth/store";

/** 开始飞书授权，并将本次校验参数保存到短期 Cookie。 */
export async function GET(request: NextRequest) {
  if (localAdminOnly()) return new NextResponse(null, { status: 404 });
  if (usesHoeAuth()) return new NextResponse(null, { status: 404 });
  try {
    const state = randomToken();
    const verifier = randomToken();
    const response = NextResponse.redirect(await authorizeUrl(state, verifier));
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, next: returnPath(request.nextUrl.searchParams.get("next")) }), {
      httpOnly: true,
      secure: authOrigin().protocol === "https:",
      sameSite: "lax",
      path: CALLBACK_PATH,
      maxAge: CALLBACK_COOKIE_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "飞书网页登录未配置，请联系管理员。" }, { status: 503 });
  }
}
