import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/** 选择网页登录方式，默认保留飞书授权。 */
export function usesHoeAuth(): boolean {
  return process.env.WEB_AUTH_MODE === "hoe" || usesHoeApproval();
}

/** 启用 HOE 登录后的飞书审批。 */
export function usesHoeApproval(): boolean {
  return process.env.WEB_AUTH_MODE === "hoe_approval";
}

/** 使用 HOE 的公开客户端密钥创建当前请求专用的认证客户端。 */
export function hoeClient(request: NextRequest, response: NextResponse) {
  const url = process.env.HOE_SUPABASE_URL;
  const key = process.env.HOE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("HOE 登录未配置");

  return createServerClient(url, key, {
    cookieOptions: {
      name: "pool_hoe_auth",
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.APP_PUBLIC_URL ?? request.url).startsWith("https:"),
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        // 当前请求使用刷新后的会话，浏览器从响应中同步同一组 Cookie。
        for (const { name, value, options } of cookies) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) }) },
  });
}

/** 只接受数据库中显式授权的 HOE 用户。RLS 将查询限定为当前用户。 */
export async function canAccessHoe(client: ReturnType<typeof hoeClient>, userId: string): Promise<boolean> {
  const { data, error } = await client.from("pool_head_web_access").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("HOE 访问名单暂不可用");
  return data !== null;
}
