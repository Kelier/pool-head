import { digest } from "./store";

export const OAUTH_COOKIE = "pool_feishu_oauth";
export const CALLBACK_PATH = "/api/auth/callback";
export const CALLBACK_COOKIE_SECONDS = 300;

/** 固定站点来源，回调地址不依赖客户端传入的 Host。 */
export function authOrigin(): URL {
  const url = new URL(process.env.APP_PUBLIC_URL ?? "http://localhost:3111");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("登录地址需要 HTTPS");
  }
  return new URL(url.origin);
}

/** 登录完成后只允许跳回本站路径。 */
export function returnPath(value?: string | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 1000 || /[\\\u0000-\u001f]/.test(value) || value.startsWith("//")) return "/";
  const path = new URL(value, "https://local.invalid");
  return path.pathname.startsWith("//") || path.pathname === "/login" || path.pathname.startsWith("/api/") ? "/" : path.pathname + path.search;
}

/** 使用现有飞书自建应用的凭证，生成固定的授权服务地址。 */
function feishuConfig() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("飞书登录未配置");
  const isLark = process.env.FEISHU_BASE_URL === "https://open.larksuite.com";
  return {
    appId,
    appSecret,
    accounts: isLark ? "https://accounts.larksuite.com" : "https://accounts.feishu.cn",
    api: isLark ? "https://open.larksuite.com" : "https://open.feishu.cn",
    redirectUri: new URL(CALLBACK_PATH, authOrigin()).href,
  };
}

/** 生成带 state 和 PKCE 的飞书网页授权链接。 */
export async function authorizeUrl(state: string, verifier: string): Promise<URL> {
  const cfg = feishuConfig();
  const url = new URL("/open-apis/authen/v1/authorize", cfg.accounts);
  url.search = new URLSearchParams({
    client_id: cfg.appId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    state,
    code_challenge_method: "S256",
    code_challenge: await digest(verifier),
  }).toString();
  return url;
}

/** 在服务器端兑换授权码并读取飞书确认的用户身份。 */
export async function exchangeIdentity(code: string, verifier: string) {
  const cfg = feishuConfig();
  const token = await fetch(`${cfg.accounts}/oauth/v3/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const data = await token.json() as { code?: number; access_token?: string };
  if (!token.ok || (data.code !== undefined && data.code !== 0) || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error(`飞书授权码兑换失败（HTTP ${token.status}，业务码 ${data.code ?? "无"}）`);
  }

  const profile = await fetch(`${cfg.api}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const user = await profile.json() as { code: number; data?: { open_id?: string; name?: string; tenant_key?: string } };
  if (!profile.ok || user.code !== 0 || typeof user.data?.open_id !== "string" || !user.data.open_id) {
    throw new Error(`飞书用户身份获取失败（HTTP ${profile.status}，业务码 ${user.code ?? "无"}）`);
  }
  const tenantKey = user.data.tenant_key ?? null;
  const allowedTenant = process.env.FEISHU_WEB_TENANT_KEY?.trim();
  if (allowedTenant && tenantKey !== allowedTenant) return null;
  return { appId: cfg.appId, openId: user.data.open_id, tenantKey, name: user.data.name ?? null };
}
