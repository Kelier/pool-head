// 飞书机器人 · 长连接模式（无需公网地址，适合本机 / 内网服务器）。
// 用法：pnpm bot      需要先启动 Web 应用（pnpm dev / pnpm start），写操作经 HTTP 转给它，保证 TikHub 限速只有一份。
import * as lark from "@larksuiteoapi/node-sdk";
import { botDeps, handleMessageEvent, httpBackend, startAlertPusher, startDigest } from "../src/lib/bot";
import { feishuConfigFromEnv } from "../src/lib/bot/feishu";
import { runLocalNpr } from "../src/lib/bot/npr";
import type { MessageEvent } from "../src/lib/bot/events";

const { appId, appSecret, baseUrl } = feishuConfigFromEnv();
const appUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3111";
const deps = { ...botDeps(httpBackend(appUrl)), nprRunner: runLocalNpr };

const dispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data: unknown) => {
    // 不阻塞事件确认：飞书对长连接事件同样要求快速 ack
    void handleMessageEvent(data as MessageEvent, deps).catch((e) => console.error("[bot] event", e));
  },
});

const ws = new lark.WSClient({
  appId,
  appSecret,
  domain: baseUrl.includes("larksuite") ? lark.Domain.Lark : lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.info,
  onReady: () => {
    console.log(`[bot] 飞书长连接已建立；Web 应用：${appUrl}`);
    if (process.env.FEISHU_PUSH_ALERTS !== "0") {
      const publicUrl = process.env.APP_PUBLIC_URL || "http://localhost:3111";
      startAlertPusher(deps.sender, publicUrl);
      startDigest(deps.sender, publicUrl);
    }
  },
  onError: () => {
    console.error("[bot] 飞书长连接建立失败，请检查上方 SDK 错误、应用凭证与事件订阅配置。");
  },
});
console.log(`[bot] 正在连接飞书；Web 应用：${appUrl}`);
await ws.start({ eventDispatcher: dispatcher });
