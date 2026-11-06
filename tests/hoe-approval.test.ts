import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { APPROVAL_COOKIE, APPROVED_SESSION_COOKIE, approveLogin, createApproval, resolveFeishuUser } from "../src/lib/auth/approval";
import { OAUTH_COOKIE } from "../src/lib/auth/feishu";
import { GET as approvalLink, POST as redeem } from "../src/app/api/auth/hoe/approval/route";
import { GET as callback } from "../src/app/api/auth/callback/route";
import { middleware } from "../src/middleware";

const ORIGIN = "https://monitor.example.com";
const APPROVAL_PATH = "/api/auth/hoe/approval";
const APP = "cli_test";
const USER = "hoe-user";
const OPEN_ID = "ou_bound";

const TEST_DB = join(mkdtempSync(join(tmpdir(), "pool-approval-")), "test.db");
beforeEach(() => vi.stubEnv("DB_FILE", TEST_DB));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** 模拟两个互不共享 Cookie 的浏览器。 */
function request(path: string, cookie?: [string, string], method = "GET") {
  return new NextRequest(ORIGIN + path, {
    method, headers: { origin: ORIGIN, ...(cookie && { cookie: `${cookie[0]}=${encodeURIComponent(cookie[1])}` }) },
  });
}

it("只有绑定的飞书用户可以批准，只有原浏览器可消费一次，删除绑定立即撤权", async () => {
  vi.stubEnv("WEB_AUTH_MODE", "hoe_approval");
  vi.stubEnv("APP_PUBLIC_URL", ORIGIN);
  vi.stubEnv("FEISHU_APP_ID", APP);
  vi.stubEnv("FEISHU_APP_SECRET", "test");
  vi.stubEnv("FEISHU_WEB_TENANT_KEY", "");
  db().prepare("INSERT INTO hoe_approval_members VALUES (?, ?, ?)").run(USER, APP, OPEN_ID);
  const challenge = createApproval(USER, APP, OPEN_ID, "/tasks");
  const browser = [APPROVAL_COOKIE, challenge.browserToken] as [string, string];

  expect(approveLogin(challenge.approvalToken, { appId: APP, openId: "ou_other" })).toBe(false);
  expect((await redeem(request(APPROVAL_PATH, browser, "POST"))).headers.get("location")).toContain("approval=pending");

  const link = await approvalLink(request(`${APPROVAL_PATH}?token=${challenge.approvalToken}`));
  const flow = link.cookies.get(OAUTH_COOKIE)!.value;
  const state = new URL(link.headers.get("location")!).searchParams.get("state");
  const mockFetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "feishu-test" }))
    .mockResolvedValueOnce(Response.json({ code: 0, data: { open_id: OPEN_ID } }));
  vi.stubGlobal("fetch", mockFetch);
  const approved = await callback(request(`/api/auth/callback?code=test&state=${state}`, [OAUTH_COOKIE, flow]));
  expect(approved.headers.get("location")).toContain("approval=confirmed");
  expect(approved.cookies.get(APPROVED_SESSION_COOKIE)).toBeUndefined();
  expect((await redeem(request(APPROVAL_PATH, undefined, "POST"))).headers.get("location")).toContain("approval=expired");

  const signedIn = await redeem(request(APPROVAL_PATH, browser, "POST"));
  const session = signedIn.cookies.get(APPROVED_SESSION_COOKIE)!.value;
  expect(signedIn.headers.get("location")).toBe(ORIGIN + "/tasks");
  expect((await redeem(request(APPROVAL_PATH, browser, "POST"))).headers.get("location")).toContain("approval=expired");
  const api = () => middleware(request("/api/tasks", [APPROVED_SESSION_COOKIE, session]));
  expect((await api()).headers.get("x-middleware-next")).toBe("1");
  db().prepare("DELETE FROM hoe_approval_members WHERE user_id = ?").run(USER);
  expect((await api()).status).toBe(401);
});


it("仅自动绑定白名单中的已验证邮箱，并复用已有绑定", async () => {
  vi.stubEnv("HOE_APPROVAL_AUTO_BIND_EMAILS", "allowed@example.com");
  const lookup = vi.fn(async () => "ou_autobound");
  const user = { id: "auto-user", email: "Allowed@example.com" };
  expect(await resolveFeishuUser(user, APP, lookup)).toBeUndefined();
  expect(await resolveFeishuUser({ ...user, email: "other@example.com", email_confirmed_at: "now" }, APP, lookup)).toBeUndefined();
  expect(lookup).not.toHaveBeenCalled();

  const verified = { ...user, email_confirmed_at: "now" };
  expect(await resolveFeishuUser(verified, APP, lookup)).toBe("ou_autobound");
  expect(await resolveFeishuUser(verified, APP, lookup)).toBe("ou_autobound");
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledWith("allowed@example.com");
});
