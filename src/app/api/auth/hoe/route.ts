import { NextRequest, NextResponse } from "next/server";
import { authOrigin, returnPath } from "@/lib/auth/feishu";
import { callHogiLogin } from "@/lib/auth/hogi-login";
import { APPROVAL_COOKIE, APPROVAL_ROUTE, APPROVAL_SECONDS, cancelApproval, createApproval, resolveFeishuUser } from "@/lib/auth/approval";
import { getFeishu } from "@/lib/bot";
import { canAccessHoe, hoeClient, usesHoeApproval, usesHoeAuth } from "@/lib/auth/hoe";

/** 使用已有 HOE 账号登录，账号获得项目授权后才保存会话。 */
export async function POST(request: NextRequest) {
  if (!usesHoeAuth()) return new NextResponse(null, { status: 404 });

  const origin = authOrigin();
  if (request.headers.get("origin") !== origin.origin) {
    return NextResponse.json({ error: "请求来源不合法" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const target = form?.get("next");
  const next = returnPath(typeof target === "string" ? target : null);
  const email = form?.get("email");
  const password = form?.get("password");
  const proof = form?.get("tencentCaptcha");

  /** 跳回登录页，保留用户原本想打开的页面。 */
  function failure(error: string) {
    const login = new URL("/login", origin);
    login.search = new URLSearchParams({ error, next }).toString();
    const response = NextResponse.redirect(login, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) return failure("credentials");

  let stage = "hogi";
  try {
    const response = NextResponse.redirect(new URL(next, origin), 303);
    response.headers.set("Cache-Control", "no-store");
    const tencentCaptcha: unknown = typeof proof === "string" && proof ? JSON.parse(proof) : undefined;
    const result = await callHogiLogin("signin_with_password", { email: email.trim(), password, tencentCaptcha }, origin);
    if (result.code === "CAPTCHA_REQUIRED" || result.code === "CAPTCHA_FAILED") return failure("captcha");
    if (result.code === "SERVICE_ERROR") return failure("hogi");
    if (result.code === "CONFIRM-EMAIL") return failure("confirmEmail");
    if (result.code !== "SUCCESS") {
      const code = typeof result.code === "string" && /^[A-Z_-]{1,48}$/.test(result.code) ? result.code : "UNKNOWN";
      console.warn("[hoe-auth] Hogi 登录被拒绝，返回码", code);
      return failure(code === "FAILED" || code === "INVALID_PARAMS" ? "credentials" : "hogi");
    }
    stage = "session";
    if (!result.accessToken || !result.refreshToken) return failure(stage);

    const client = hoeClient(request, response);
    if (usesHoeApproval()) {
      const { data, error } = await client.auth.getUser(result.accessToken);
      if (error || !data.user) return failure(stage);
      if (data.user.is_anonymous) return failure("access");
      stage = "approvalService";
      const appId = process.env.FEISHU_APP_ID;
      if (!appId || !process.env.FEISHU_APP_SECRET) return failure(stage);
      stage = "approvalDirectory";
      const openId = await resolveFeishuUser(data.user, appId, (verifiedEmail) => getFeishu().findOpenIdByEmail(verifiedEmail));
      stage = "approvalService";
      if (!openId) return failure("approvalBinding");
      const { browserToken, approvalToken } = createApproval(data.user.id, appId, openId, next);
      try {
        const link = new URL(APPROVAL_ROUTE, origin);
        link.searchParams.set("token", approvalToken);
        await getFeishu().directText(openId, `竞品投放监测收到一次 HOE 登录请求。确认是本人发起后，点击链接并完成飞书授权（10 分钟内有效）：\n${link.href}`);
      } catch (error) {
        cancelApproval(browserToken);
        throw error;
      }
      const waiting = NextResponse.redirect(new URL("/login?approval=pending", origin), 303);
      waiting.headers.set("Cache-Control", "no-store");
      waiting.cookies.set(APPROVAL_COOKIE, browserToken, {
        path: APPROVAL_ROUTE, httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax", maxAge: APPROVAL_SECONDS,
      });
      return waiting;
    }
    const { data, error } = await client.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken });
    if (error || !data.user || !data.session) return failure(stage);
    stage = "accessService";
    if (data.user.is_anonymous || !await canAccessHoe(client, data.user.id)) return failure("access");
    return response;
  } catch {
    return failure(stage);
  }
}
