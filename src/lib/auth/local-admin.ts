import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { db } from "../db";
import { TOKEN_PATTERN } from "./store";

export const LOCAL_ADMIN_COOKIE = "pool_local_admin";
export const LOCAL_ADMIN_NAME = "local-admin";
export const LOCAL_ADMIN_SECONDS = 7 * 24 * 60 * 60;
const scryptAsync = promisify(scrypt);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]);

/** 新安装默认使用本机管理员，保留显式配置的登录方式。 */
export function localAdminOnly(): boolean {
  const mode = process.env.WEB_AUTH_MODE;
  return !mode || mode === "local_admin";
}

/** 管理员模式支持本机生产启动，旧开关仍仅用于开发环境。 */
export function localAdminEnabled(): boolean {
  return localAdminOnly() || (process.env.NODE_ENV === "development" && process.env.LOCAL_ADMIN_ENABLED === "1");
}

/** 外部来源或转发地址不能使用本机备用入口。 */
export function isLocalAdminRequest(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()) ?? [];
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = request.headers.get("host");
  return localAdminEnabled() && LOOPBACK.has(request.nextUrl.hostname)
    && (!host || host === request.nextUrl.host)
    && (!forwardedHost || forwardedHost === request.nextUrl.host)
    && forwarded.every((ip) => LOOPBACK.has(ip))
    && !request.headers.has("forwarded");
}

/** 密码和会话使用不同的摘要方案。 */
function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** 为密码生成独立盐及 scrypt 摘要。 */
async function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${(await scryptAsync(password, salt, 64) as Buffer).toString("hex")}`;
}

/** 账号密码必须足够长，同时限制输入长度。 */
export function validLocalAdminPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128;
}

/** 从终端创建或恢复管理员凭证，并撤销旧会话。 */
export async function provisionLocalAdmin(password: string): Promise<number> {
  if (!validLocalAdminPassword(password)) throw new Error("密码需为 12 至 128 个字符");
  const hashed = await passwordHash(password);
  const expiresAt = Date.now() + LOCAL_ADMIN_SECONDS * 1000;
  db().prepare(`INSERT INTO local_admin (id, password_hash, expires_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash, expires_at=excluded.expires_at, session_hash=NULL`)
    .run(hashed, expiresAt);
  return expiresAt;
}

/** 校验密码并签发当前管理员会话，防止并发重置后旧密码签发。 */
export async function signInLocalAdmin(username: string, password: string): Promise<string | undefined> {
  if (username !== LOCAL_ADMIN_NAME || !validLocalAdminPassword(password)) return undefined;
  const row = db().prepare("SELECT password_hash FROM local_admin WHERE id=1 AND expires_at>?")
    .get(Date.now()) as { password_hash: string } | undefined;
  if (!row) return undefined;
  const candidate = await passwordHash(password, row.password_hash.split(":")[0]);
  if (!timingSafeEqual(Buffer.from(candidate), Buffer.from(row.password_hash))) return undefined;
  const token = randomBytes(32).toString("base64url");
  const result = db().prepare("UPDATE local_admin SET session_hash=? WHERE id=1 AND password_hash=? AND expires_at>?")
    .run(sessionHash(token), row.password_hash, Date.now());
  return result.changes === 1 ? token : undefined;
}

/** 检查管理员会话，并返回当前账号到期时间。 */
export function localAdminExpiry(token?: string): number | undefined {
  if (!token || !TOKEN_PATTERN.test(token)) return undefined;
  return (db().prepare("SELECT expires_at FROM local_admin WHERE id=1 AND session_hash=? AND expires_at>?")
    .get(sessionHash(token), Date.now()) as { expires_at: number } | undefined)?.expires_at;
}

/** 重置成功后旧会话失效，并为当前浏览器签发新会话。 */
export async function resetLocalAdmin(token: string, password: string): Promise<string | undefined> {
  if (!localAdminExpiry(token) || !validLocalAdminPassword(password)) return undefined;
  const hashed = await passwordHash(password);
  const next = randomBytes(32).toString("base64url");
  const now = Date.now();
  const result = db().prepare("UPDATE local_admin SET password_hash=?, session_hash=?, expires_at=? WHERE id=1 AND session_hash=? AND expires_at>?")
    .run(hashed, sessionHash(next), now + LOCAL_ADMIN_SECONDS * 1000, sessionHash(token), now);
  return result.changes === 1 ? next : undefined;
}

/** 退出当前备用管理员会话。 */
export function revokeLocalAdmin(token: string): void {
  if (TOKEN_PATTERN.test(token)) db().prepare("UPDATE local_admin SET session_hash=NULL WHERE id=1 AND session_hash=?").run(sessionHash(token));
}
