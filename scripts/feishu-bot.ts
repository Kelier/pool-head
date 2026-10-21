// 飞书机器人 · 长连接模式（无需公网地址，适合本机 / 内网服务器）。
// 用法：pnpm bot      需要先启动 Web 应用（pnpm dev / pnpm start），写操作经 HTTP 转给它，保证 TikHub 限速只有一份。
import * as lark from "@larksuiteoapi/node-sdk";
import { botDeps, handleMessageEvent, httpBackend, startAlertPusher } from "../src/lib/bot";
import type { MessageEvent } from "../src/lib/bot/events";

const appId = process.env.FEISHU_APP_ID, appSecret = process.env.FEISHU_APP_SECRET;
if (!appId || !appSecret) {
  console.error("缺少 FEISHU_APP_ID / FEISHU_APP_SECRET，见 docs/FEISHU_BOT.md");
  process.exit(1);
}
const appUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3111";
const deps = botDeps(httpBackend(appUrl));

const dispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data: unknown) => {
    // 不阻塞事件确认：飞书对长连接事件同样要求快速 ack
    void handleMessageEvent(data as MessageEvent, deps).catch((e) => console.error("[bot] event", e));
  },
});

const ws = new lark.WSClient({ appId, appSecret, domain: process.env.FEISHU_BASE_URL?.includes("larksuite") ? lark.Domain.Lark : lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.info });
ws.start({ eventDispatcher: dispatcher });
if (process.env.FEISHU_PUSH_ALERTS !== "0") startAlertPusher(deps.sender, process.env.APP_PUBLIC_URL || "http://localhost:3111");
console.log(`[bot] 长连接已启动；Web 应用：${appUrl}`);
