// 飞书事件订阅（webhook 模式）：需要公网 HTTPS 地址。无公网时用长连接模式：pnpm bot。
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { decryptFeishu } from "@/lib/bot/crypto";
import { botDeps, directBackend, handleMessageEvent } from "@/lib/bot";
import type { MessageEvent } from "@/lib/bot/events";

export const runtime = "nodejs";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  const token = process.env.FEISHU_VERIFICATION_TOKEN;
  if (!token) return NextResponse.json({ error: "机器人未配置（缺少 FEISHU_VERIFICATION_TOKEN）" }, { status: 503 });

  let body = (await req.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (typeof body.encrypt === "string") {
    const k = process.env.FEISHU_ENCRYPT_KEY;
    if (!k) return NextResponse.json({ error: "收到加密事件，但未配置 FEISHU_ENCRYPT_KEY" }, { status: 400 });
    try { body = JSON.parse(decryptFeishu(body.encrypt, k)); } catch { return NextResponse.json({ error: "解密失败" }, { status: 400 }); }
  }

  const got = String(body?.header?.token ?? body?.token ?? "");
  if (!same(got, token)) return NextResponse.json({ error: "token 校验失败" }, { status: 401 });

  if (body?.type === "url_verification") return NextResponse.json({ challenge: body.challenge });

  if (body?.header?.event_type === "im.message.receive_v1") {
    let deps;
    try { deps = botDeps(directBackend); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 503 }); }
    // 先返回 200（飞书要求 3 秒内响应，否则会重试），后台处理
    void handleMessageEvent(body.event as MessageEvent, deps).catch((e) => console.error("[bot] event", e));
  }
  return NextResponse.json({ code: 0 });
}
