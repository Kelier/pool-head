import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as login } from "../src/app/api/auth/login/route";
import { GET as callback } from "../src/app/api/auth/callback/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { OAUTH_COOKIE, returnPath } from "../src/lib/auth/feishu";
import { digest, SESSION_COOKIE } from "../src/lib/auth/store";
import { middleware } from "../src/middleware";

const APP_ORIGIN = "https://monitor.example.com";

/** 构造和浏览器一致的请求 Cookie。 */
function request(path: string, cookie?: [string, string]) {
  return new NextRequest(APP_ORIGIN + path, { headers: cookie ? { cookie: `${cookie[0]}=${encodeURIComponent(cookie[1])}` } : undefined });
}

beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_URL", APP_ORIGIN);
  vi.stubEnv("FEISHU_APP_ID", "cli_test");
  vi.stubEnv("FEISHU_APP_SECRET", "test-secret");
  vi.stubEnv("FEISHU_BASE_URL", "");
  vi.stubEnv("FEISHU_WEB_TENANT_KEY", "tenant");
  vi.stubEnv("SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("飞书网页登录", () => {
  it("匿名访问控制台或 API 被拦截，退出和导出入口也受保护", async () => {
    expect((await middleware(request("/tasks/12"))).headers.get("location")).toBe(APP_ORIGIN + "/login?next=%2Ftasks%2F12");
    expect((await middleware(request("/api/export?kind=accounts"))).status).toBe(401);
    expect((await middleware(new NextRequest(APP_ORIGIN + "/api/auth/logout", { method: "POST" }))).status).toBe(401);
  });

  it("只放行通过飞书事件路由或持有专用服务密钥的抓取入口", async () => {
    const secret = "bot-test-secret".repeat(3);
    vi.stubEnv("BOT_BACKEND_SECRET", secret);
    const headers = { "x-bot-backend-secret": secret };
    expect((await middleware(new NextRequest(APP_ORIGIN + "/api/competitors/1/run", { method: "POST" }))).status).toBe(401);
    expect((await middleware(new NextRequest(APP_ORIGIN + "/api/competitors/1/run", { method: "POST", headers }))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(new NextRequest(APP_ORIGIN + "/api/settings", { method: "POST", headers }))).status).toBe(401);
    expect((await middleware(new NextRequest(APP_ORIGIN + "/api/feishu/events", { method: "POST" }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("回调 state 无效时拒绝交换授权码，也不会建立会话", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const start = await login(request("/api/auth/login"));
    const flow = start.cookies.get(OAUTH_COOKIE)!.value;
    const rejected = await callback(request("/api/auth/callback?code=abc&state=wrong", [OAUTH_COOKIE, flow]));
    expect(rejected.headers.get("location")).toContain("error=authorization");
    expect(rejected.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(returnPath("/a/..//evil.example")).toBe("/");
  });

  it("飞书身份验证后写入账号和会话，登录可访问 API，退出会撤销会话", async () => {
    const start = await login(request("/api/auth/login?next=%2Ftasks%2F12"));
    const target = new URL(start.headers.get("location")!);
    const flow = start.cookies.get(OAUTH_COOKIE)!.value;
    expect(target.hostname).toBe("accounts.feishu.cn");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("code_challenge")).toBe(await digest(JSON.parse(flow).verifier));

    const mockFetch = vi.fn<(url: URL | string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ access_token: "feishu-token" }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { open_id: "ou_test", tenant_key: "tenant", name: "示例" } }))
      .mockResolvedValueOnce(Response.json([{ id: "account-id" }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ account_id: "account-id" }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", mockFetch);

    const result = await callback(request(`/api/auth/callback?code=abc&state=${target.searchParams.get("state")}`, [OAUTH_COOKIE, flow]));
    expect(result.headers.get("location")).toBe(APP_ORIGIN + "/tasks/12");
    const cookie = result.cookies.get(SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    expect(JSON.parse(String(mockFetch.mock.calls[2][1]?.body))).toMatchObject({ feishu_open_id: "ou_test" });
    expect(JSON.parse(String(mockFetch.mock.calls[4][1]?.body))).toMatchObject({ token_hash: await digest(cookie.value) });

    const sessionRequest = request("/api/tasks", [SESSION_COOKIE, cookie.value]);
    expect((await middleware(sessionRequest)).headers.get("x-middleware-next")).toBe("1");
    const signedOut = await logout(new NextRequest(APP_ORIGIN + "/api/auth/logout", { method: "POST", headers: sessionRequest.headers }));
    expect(signedOut.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
    expect(mockFetch.mock.calls[6][1]?.method).toBe("DELETE");
    expect((await middleware(sessionRequest)).status).toBe(401);
  });
});
