export const SESSION_COOKIE = "pool_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 生成可放入 Cookie 的随机凭证。 */
export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** 将二进制摘要编码成 URL 安全字符串。 */
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 数据库只保存会话摘要，OAuth PKCE 也使用同一种编码。 */
export async function digest(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

/** 账号库密钥仅在服务端和鉴权中间件使用。 */
async function dataRequest(table: string, query: Record<string, string>, init?: RequestInit): Promise<Response> {
  const projectUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl || !secret) throw new Error("账号数据库未配置");
  const url = new URL(`/rest/v1/${table}`, projectUrl);
  url.search = new URLSearchParams(query).toString();
  const headers = new Headers(init?.headers);
  headers.set("apikey", secret);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`账号数据库请求失败（${response.status}）`);
  return response;
}

/** 飞书身份验证成功后更新账号资料并创建一个独立会话。 */
export async function createSession(identity: { appId: string; openId: string; tenantKey: string | null; name: string | null }): Promise<string> {
  const now = new Date();
  const account = await dataRequest("web_accounts", { on_conflict: "feishu_app_id,feishu_open_id", select: "id" }, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      feishu_app_id: identity.appId,
      feishu_open_id: identity.openId,
      feishu_tenant_key: identity.tenantKey,
      display_name: identity.name,
      last_login_at: now.toISOString(),
    }),
  });
  const [{ id }] = await account.json() as Array<{ id: string }>;
  const session = randomToken();
  await dataRequest("web_sessions", { account_id: `eq.${id}`, expires_at: `lte.${now.toISOString()}` }, { method: "DELETE" });
  await dataRequest("web_sessions", {}, {
    method: "POST",
    body: JSON.stringify({
      token_hash: await digest(session),
      account_id: id,
      expires_at: new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString(),
    }),
  });
  return session;
}

/** 只有数据库中存在且未过期的会话可以访问业务页面和 API。 */
export async function hasSession(token?: string): Promise<boolean> {
  const appId = process.env.FEISHU_APP_ID;
  const allowedTenant = process.env.FEISHU_WEB_TENANT_KEY?.trim();
  if (!appId || !token || !TOKEN_PATTERN.test(token)) return false;
  const response = await dataRequest("web_sessions", {
    select: "account_id,web_accounts!inner(feishu_app_id)",
    token_hash: `eq.${await digest(token)}`,
    "web_accounts.feishu_app_id": `eq.${appId}`,
    ...(allowedTenant && { "web_accounts.feishu_tenant_key": `eq.${allowedTenant}` }),
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });
  return (await response.json() as unknown[]).length === 1;
}

/** 退出后在服务端撤销当前会话。 */
export async function revokeSession(token?: string): Promise<void> {
  if (token && TOKEN_PATTERN.test(token)) {
    await dataRequest("web_sessions", { token_hash: `eq.${await digest(token)}` }, { method: "DELETE" });
  }
}
