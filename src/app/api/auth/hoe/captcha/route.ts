import { NextRequest, NextResponse } from "next/server";
import { authOrigin } from "@/lib/auth/feishu";
import { usesHoeAuth } from "@/lib/auth/hoe";
import { callHogiLogin } from "@/lib/auth/hogi-login";

/** 获取 HOE 当前策略下用于启动腾讯验证码的公开配置。 */
export async function POST(request: NextRequest) {
  if (!usesHoeAuth()) return new NextResponse(null, { status: 404 });
  const origin = authOrigin();
  if (request.headers.get("origin") !== origin.origin) return new NextResponse(null, { status: 403 });
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || !body.email.trim()) return new NextResponse(null, { status: 400 });

  try {
    const result = await callHogiLogin("tencent_captcha_config", { scene: "email_login", identifier: body.email.trim() }, origin);
    const { code, captchaAppId, aidEncrypted, aidEncryptedType } = result;
    return NextResponse.json({ code, captchaAppId, aidEncrypted, aidEncryptedType }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ code: "SERVICE_ERROR" }, { status: 503 });
  }
}
