import { createHash } from "node:crypto";
import { db } from "../db";
import { randomToken, SESSION_SECONDS, TOKEN_PATTERN } from "./store";

export const APPROVAL_SECONDS = 600;
export const APPROVAL_COOKIE = "pool_hoe_approval";
export const APPROVED_SESSION_COOKIE = "pool_hoe_local";
export const APPROVAL_ROUTE = "/api/auth/hoe/approval";

/** 摘要用于数据库索引，原始票据仅保存在链接和浏览器 Cookie 中。 */
function hash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** 为当前 HOE 账号查找已登记的飞书身份。 */
export function boundFeishuUser(userId: string, appId: string): string | undefined {
  return (db().prepare("SELECT feishu_open_id FROM hoe_approval_members WHERE user_id = ? AND feishu_app_id = ?")
    .get(userId, appId) as { feishu_open_id: string } | undefined)?.feishu_open_id;
}

/** 为明确获准、邮箱已验证的 HOE 用户自动补绑定，优先保留已有绑定。 */
export async function resolveFeishuUser(
  user: { id: string; email?: string; email_confirmed_at?: string },
  appId: string,
  lookup: (email: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const existing = boundFeishuUser(user.id, appId);
  if (existing) return existing;
  const email = user.email?.trim().toLowerCase();
  const allowed = (process.env.HOE_APPROVAL_AUTO_BIND_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase());
  if (!email || !user.email_confirmed_at || !allowed.includes(email)) return undefined;

  const openId = await lookup(email);
  if (!openId) return undefined;
  db().prepare(`INSERT INTO hoe_approval_members (user_id, feishu_app_id, feishu_open_id)
    VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).run(user.id, appId, openId);
  return boundFeishuUser(user.id, appId);
}

/** 分开发放给飞书和原浏览器的票据。 */
export function createApproval(userId: string, appId: string, openId: string, next: string) {
  const browserToken = randomToken();
  const approvalToken = randomToken();
  const d = db();
  const now = Date.now();
  d.prepare("DELETE FROM hoe_login_approvals WHERE expires_at <= ?").run(now);
  d.prepare("DELETE FROM hoe_login_sessions WHERE expires_at <= ?").run(now);
  d.prepare("INSERT INTO hoe_login_approvals (browser_hash, approval_hash, user_id, app_id, open_id, next_path, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(hash(browserToken), hash(approvalToken), userId, appId, openId, next, now + APPROVAL_SECONDS * 1000);
  return { browserToken, approvalToken };
}

/** 取消没有成功发送给飞书用户的审批。 */
export function cancelApproval(browserToken: string): void {
  db().prepare("DELETE FROM hoe_login_approvals WHERE browser_hash = ?").run(hash(browserToken));
}

/** 判断链接是否仍对应一个待审批请求。 */
export function pendingApproval(token: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;
  return !!db().prepare("SELECT 1 FROM hoe_login_approvals WHERE approval_hash = ? AND expires_at > ? AND approved_at IS NULL")
    .get(hash(token), Date.now());
}

/** 只有飞书核验过的绑定用户能批准。 */
export function approveLogin(token: string, identity: { appId: string; openId: string }): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;
  const now = Date.now();
  return db().prepare(`UPDATE hoe_login_approvals SET approved_at = ?
    WHERE approval_hash = ? AND app_id = ? AND open_id = ? AND expires_at > ? AND approved_at IS NULL
    AND EXISTS (SELECT 1 FROM hoe_approval_members m WHERE m.user_id = hoe_login_approvals.user_id
      AND m.feishu_app_id = hoe_login_approvals.app_id AND m.feishu_open_id = hoe_login_approvals.open_id)`)
    .run(now, hash(token), identity.appId, identity.openId, now).changes === 1;
}

/** 仅原浏览器可一次性消费审批，消费与发放会话在同一个事务里完成。 */
export function redeemApproval(browserToken?: string): { status: "pending" | "expired" } | { status: "approved"; session: string; next: string } {
  if (!browserToken || !TOKEN_PATTERN.test(browserToken)) return { status: "expired" };
  const d = db();
  const key = hash(browserToken);
  const now = Date.now();
  const session = randomToken();
  d.exec("BEGIN IMMEDIATE");
  try {
    const row = d.prepare(`DELETE FROM hoe_login_approvals
      WHERE browser_hash = ? AND expires_at > ? AND approved_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM hoe_approval_members m WHERE m.user_id = hoe_login_approvals.user_id
        AND m.feishu_app_id = hoe_login_approvals.app_id AND m.feishu_open_id = hoe_login_approvals.open_id)
      RETURNING user_id, app_id, open_id, next_path`).get(key, now) as
      { user_id: string; app_id: string; open_id: string; next_path: string } | undefined;
    if (row) {
      d.prepare("INSERT INTO hoe_login_sessions (token_hash, user_id, app_id, open_id, expires_at) VALUES (?, ?, ?, ?, ?)")
        .run(hash(session), row.user_id, row.app_id, row.open_id, now + SESSION_SECONDS * 1000);
      d.exec("COMMIT");
      return { status: "approved", session, next: row.next_path };
    }
    const pending = d.prepare(`SELECT 1 FROM hoe_login_approvals a JOIN hoe_approval_members m ON
      m.user_id = a.user_id AND m.feishu_app_id = a.app_id AND m.feishu_open_id = a.open_id
      WHERE a.browser_hash = ? AND a.expires_at > ? AND a.approved_at IS NULL`).get(key, now);
    d.exec("COMMIT");
    return { status: pending ? "pending" : "expired" };
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

/** 每次访问检查本地会话和当前绑定，撤销绑定立即生效。 */
export function hasApprovedSession(token?: string): boolean {
  if (!token || !TOKEN_PATTERN.test(token)) return false;
  return !!db().prepare(`SELECT 1 FROM hoe_login_sessions s JOIN hoe_approval_members m ON
    m.user_id = s.user_id AND m.feishu_app_id = s.app_id AND m.feishu_open_id = s.open_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND s.app_id = ?`).get(hash(token), Date.now(), process.env.FEISHU_APP_ID ?? "");
}

/** 删除当前浏览器的本站会话。 */
export function revokeApprovedSession(token?: string): void {
  if (token && TOKEN_PATTERN.test(token)) db().prepare("DELETE FROM hoe_login_sessions WHERE token_hash = ?").run(hash(token));
}
