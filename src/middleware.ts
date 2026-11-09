import { NextRequest, NextResponse } from "next/server";
import { canAccessHoe, hoeClient, usesHoeApproval, usesHoeAuth } from "@/lib/auth/hoe";
import { APPROVAL_ROUTE, APPROVED_SESSION_COOKIE, hasApprovedSession } from "@/lib/auth/approval";
import { allowsAnonymousRead } from "@/lib/auth/mode";
import { digest, hasSession, SESSION_COOKIE } from "@/lib/auth/store";

const PUBLIC_GET = new Set(["/login", "/api/auth/login", "/api/auth/callback"]);

/** 长连接机器人只可凭服务密钥调用竞品抓取入口。 */
async function isBotRun(request: NextRequest): Promise<boolean> {
  if (request.method !== "POST" || !/^\/api\/competitors\/\d+\/run$/.test(request.nextUrl.pathname)) return false;
  const secret = process.env.BOT_BACKEND_SECRET;
  const got = request.headers.get("x-bot-backend-secret");
  if (!secret || secret.length < 32 || !got || got.length !== secret.length) return false;
  const expected = await digest(secret);
  const actual = await digest(got);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

/** 同时保护控制台、报表和业务 API，飞书 webhook 由自身的验证令牌鉴权。 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const hoe = usesHoeAuth();
  const approval = usesHoeApproval();
  if (approval && path === APPROVAL_ROUTE && ["GET", "POST"].includes(request.method)) return NextResponse.next();
  if (request.method === "GET" && PUBLIC_GET.has(path)) {
    return !hoe || path === "/login" || (approval && path === "/api/auth/callback") ? NextResponse.next() : new NextResponse(null, { status: 404 });
  }
  if (hoe && request.method === "POST" && (path === "/api/auth/hoe" || path === "/api/auth/hoe/captcha")) return NextResponse.next();
  if (request.method === "POST" && path === "/api/feishu/events") return NextResponse.next();
  if (await isBotRun(request)) return NextResponse.next();

  const anonymousRead = allowsAnonymousRead();
  const read = request.method === "GET" || request.method === "HEAD";
  if (anonymousRead && read && path !== "/api/export" && !path.startsWith("/api/auth/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const origin = request.headers.get("origin");
  if (!read && request.method !== "OPTIONS" && origin && origin !== new URL(process.env.APP_PUBLIC_URL ?? request.url).origin) {
    return NextResponse.json({ error: "请求来源不合法" }, { status: 403 });
  }

  try {
    let response = NextResponse.next();
    let authorized: boolean;
    if (approval) {
      authorized = hasApprovedSession(request.cookies.get(APPROVED_SESSION_COOKIE)?.value);
    } else if (hoe) {
      const refreshed = NextResponse.next();
      const client = hoeClient(request, refreshed);
      const { data, error } = await client.auth.getUser();
      if (error?.status && error.status >= 500) throw error;
      authorized = !error && !!data.user && !data.user.is_anonymous && await canAccessHoe(client, data.user.id);
      if (authorized) {
        response = NextResponse.next({ request: { headers: request.headers } });
        for (const cookie of refreshed.cookies.getAll()) response.cookies.set(cookie);
      }
    } else {
      authorized = await hasSession(request.cookies.get(SESSION_COOKIE)?.value);
    }
    if (authorized) {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  } catch {
    return NextResponse.json({ error: "登录服务暂时不可用" }, { status: 503 });
  }

  if (path.startsWith("/api/")) return NextResponse.json({ error: anonymousRead ? "请登录后再执行此操作" : hoe ? "请使用获准的 HOE 账号登录" : "请先通过飞书登录" }, { status: 401 });
  const login = new URL("/login", request.url);
  login.searchParams.set("next", path + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = { runtime: "nodejs", matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$|icon\\.svg$).*)"] };
