import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/auth/local-admin/route";
import { LOCAL_ADMIN_COOKIE, localAdminExpiry, provisionLocalAdmin, signInLocalAdmin } from "../src/lib/auth/local-admin";
import { middleware } from "../src/middleware";

const ORIGIN = "http://localhost:3111";
const PATH = "/api/auth/local-admin";
const OLD_PASSWORD = "test-old-credential";
const NEW_PASSWORD = "test-new-credential";

afterEach(() => vi.unstubAllEnvs());

/** 构造本机表单请求。 */
function formRequest(fields: Record<string, string>, token?: string, origin = ORIGIN) {
  return new NextRequest(ORIGIN + PATH, {
    method: "POST",
    headers: { origin, ...(token && { cookie: `${LOCAL_ADMIN_COOKIE}=${token}` }) },
    body: new URLSearchParams(fields),
  });
}

it("本机管理员仅在开发模式启用，重置凭证会使旧密码和旧会话失效", async () => {
  vi.stubEnv("DB_FILE", join(mkdtempSync(join(tmpdir(), "pool-local-admin-")), "test.db"));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("LOCAL_ADMIN_ENABLED", "1");
  const expiresAt = await provisionLocalAdmin(OLD_PASSWORD);
  expect(expiresAt - Date.now()).toBeGreaterThan(6 * 24 * 3600 * 1000);
  expect((await POST(formRequest({}, undefined, "http://other.example"))).status).toBe(403);
  expect((await POST(formRequest({ action: "reset", password: NEW_PASSWORD, confirm: NEW_PASSWORD }))).headers.get("location")).toContain("error=invalid");

  const signedIn = await POST(formRequest({ username: "local-admin", password: OLD_PASSWORD }));
  const token = signedIn.cookies.get(LOCAL_ADMIN_COOKIE)!.value;
  expect(localAdminExpiry(token)).toBe(expiresAt);
  const call = (host = ORIGIN) => middleware(new NextRequest(host + "/api/tasks", { headers: { cookie: `${LOCAL_ADMIN_COOKIE}=${token}` } }));
  expect((await call()).headers.get("x-middleware-next")).toBe("1");
  expect((await call("https://monitor.example.com")).status).toBe(401);

  const reset = await POST(formRequest({ action: "reset", password: NEW_PASSWORD, confirm: NEW_PASSWORD }, token));
  expect(reset.cookies.get(LOCAL_ADMIN_COOKIE)?.value).not.toBe(token);
  expect(localAdminExpiry(token)).toBeUndefined();
  expect(await signInLocalAdmin("local-admin", OLD_PASSWORD)).toBeUndefined();
  expect(await signInLocalAdmin("local-admin", NEW_PASSWORD)).toBeTruthy();

  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(formRequest({ username: "local-admin", password: NEW_PASSWORD }))).status).toBe(404);
});
