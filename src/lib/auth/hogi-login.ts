/** 调用 HOE 的网页登录 API，由 Hogi 负责验证腾讯票据及账号密码。 */
export async function callHogiLogin(path: "tencent_captcha_config" | "signin_with_password", body: object, origin: URL) {
  const base = process.env.HOE_HOGI_API_URL ?? "https://api-hoe-qc.hogi.ai";
  const url = new URL(`/auth/${path}`, base);
  if (url.protocol !== "https:") throw new Error("HOE 登录 API 需要 HTTPS");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hogi-apphost": origin.host, "x-hogi-user-language": "zh-CN" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HOE 登录服务 HTTP ${response.status}`);
  return response.json() as Promise<{
    code: string;
    captchaAppId?: string;
    aidEncrypted?: string;
    aidEncryptedType?: "cbc" | "gcm";
    accessToken?: string;
    refreshToken?: string;
  }>;
}
