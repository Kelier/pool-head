import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "../src/app/api/auth/hoe/route";
import { POST as captchaConfig } from "../src/app/api/auth/hoe/captcha/route";
import { middleware } from "../src/middleware";

const ORIGIN = "https://monitor.example.com";
const USER_ID = "a1d40bef-d4a5-4ba3-a041-61e6f6ef8d11";
const USER = { id: USER_ID, aud: "authenticated", is_anonymous: false };

/** 提交与浏览器相同的 HOE 登录表单。 */
function loginRequest(origin = ORIGIN, tencentCaptcha = "") {
  return new NextRequest(ORIGIN + "/api/auth/hoe", {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ email: "test@example.com", password: "example", next: "/tasks", tencentCaptcha }),
  });
}

beforeEach(() => {
  vi.stubEnv("WEB_AUTH_MODE", "hoe");
  vi.stubEnv("APP_PUBLIC_URL", ORIGIN);
  vi.stubEnv("HOE_HOGI_API_URL", "https://hogi.example.com");
  vi.stubEnv("HOE_SUPABASE_URL", "https://hoe.example.com");
  vi.stubEnv("HOE_SUPABASE_ANON_KEY", "public-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("HOE 网页登录", () => {
  it("拒绝跨站表单，且 HOE 模式下关闭飞书网页登录入口", async () => {
    expect((await login(loginRequest("https://other.example.com"))).status).toBe(403);
    expect((await middleware(new NextRequest(ORIGIN + "/api/auth/login"))).status).toBe(404);
  });

  it("从 Hogi 获取腾讯验证码配置并把腾讯票据交给 Hogi 登录接口", async () => {
    const proof = { appid: "123", ticket: "example-ticket", randstr: "example-random" };
    const mockFetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const body = JSON.parse(String(init?.body));
      if (path === "/auth/tencent_captcha_config") {
        expect(body).toEqual({ scene: "email_login", identifier: "test@example.com" });
        return Response.json({ code: "SUCCESS", captchaAppId: "123", aidEncrypted: "config", aidEncryptedType: "gcm" });
      }
      expect(path).toBe("/auth/signin_with_password");
      expect(body).toMatchObject({ tencentCaptcha: proof });
      return Response.json({ code: "CAPTCHA_FAILED" });
    });
    vi.stubGlobal("fetch", mockFetch);
    const config = await captchaConfig(new NextRequest(ORIGIN + "/api/auth/hoe/captcha", {
      method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ email: "test@example.com" }),
    }));
    expect(await config.json()).toMatchObject({ code: "SUCCESS", captchaAppId: "123" });
    const response = await login(loginRequest(ORIGIN, JSON.stringify(proof)));
    expect(response.headers.get("location")).toContain("error=captcha");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("仅为在 HOE 名单中获准的账号设置 Cookie，撤权后拒绝已有会话", async () => {
    let allowed = false;
    let accessUnavailable = false;
    const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.c2ln`;
    const fetchMock = vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/auth/signin_with_password") {
        return Response.json({ code: "SUCCESS", accessToken: token, refreshToken: "hoe-refresh" });
      }
      if (url.pathname === "/auth/v1/user") return Response.json(USER);
      expect(url.pathname).toBe("/rest/v1/pool_head_web_access");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      if (accessUnavailable) return Response.json({ code: "PGRST002", message: "schema cache unavailable" }, { status: 503 });
      return Response.json(allowed ? [{ user_id: USER_ID }] : []);
    });
    vi.stubGlobal("fetch", fetchMock);

    const denied = await login(loginRequest());
    expect(denied.headers.get("location")).toContain("error=access");
    expect(denied.cookies.getAll()).toHaveLength(0);

    accessUnavailable = true;
    const unavailable = await login(loginRequest());
    expect(unavailable.headers.get("location")).toContain("error=accessService");
    expect(unavailable.cookies.getAll()).toHaveLength(0);
    accessUnavailable = false;

    allowed = true;
    const authorized = await login(loginRequest());
    expect(authorized.headers.get("location")).toBe(ORIGIN + "/tasks");
    const cookies = authorized.cookies.getAll();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.every((cookie) => cookie.httpOnly && cookie.secure)).toBe(true);

    /** 模拟浏览器发送 SDK 设置的会话 Cookie。 */
    function apiRequest() {
      return new NextRequest(ORIGIN + "/api/tasks", { headers: { cookie: cookies.map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`).join("; ") } });
    }
    expect((await middleware(apiRequest())).headers.get("x-middleware-next")).toBe("1");
    allowed = false;
    expect((await middleware(apiRequest())).status).toBe(401);
  });
});
