import { NextRequest, NextResponse } from "next/server";
import { RateLimiter } from "@/lib/bot/auth";
import { isLocalAdminRequest, LOCAL_ADMIN_COOKIE, LOCAL_ADMIN_SECONDS, resetLocalAdmin, signInLocalAdmin, validLocalAdminPassword } from "@/lib/auth/local-admin";

const attempts = new RateLimiter(8, 60_000);

/** 本地管理员登录与密码重置均校验来源，重置额外要求有效会话。 */
export async function POST(request: NextRequest) {
  if (!isLocalAdminRequest(request)) return new NextResponse(null, { status: 404 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });

  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const resetting = form?.get("action") === "reset";
  const path = resetting ? "/local-admin/reset" : "/local-admin";
  /** 统一使用本站跳转并禁止缓存认证响应。 */
  function redirect(target: string) {
    const response = NextResponse.redirect(new URL(target, request.nextUrl.origin), 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (typeof password !== "string") return redirect(`${path}?error=invalid`);

  let token: string | undefined;
  if (resetting) {
    if (!validLocalAdminPassword(password) || password !== form?.get("confirm")) return redirect(`${path}?error=password`);
    token = await resetLocalAdmin(request.cookies.get(LOCAL_ADMIN_COOKIE)?.value ?? "", password);
  } else {
    if (!attempts.allow("local-admin")) return redirect(`${path}?error=rate`);
    const username = form?.get("username");
    token = typeof username === "string" ? await signInLocalAdmin(username.trim(), password) : undefined;
  }
  if (!token) return redirect(`${path}?error=invalid`);

  const response = redirect(resetting ? "/local-admin/reset?updated=1" : "/");
  response.cookies.set(LOCAL_ADMIN_COOKIE, token, {
    path: "/", maxAge: LOCAL_ADMIN_SECONDS, httpOnly: true, sameSite: "strict", secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
