import { FeishuClient, feishuConfigFromEnv } from "./feishu";
import type { EventDeps } from "./events";
import type { BotBackend } from "./types";

const g = globalThis as unknown as { __feishu?: FeishuClient };
export const getFeishu = () => (g.__feishu ??= new FeishuClient(feishuConfigFromEnv()));

export function botDeps(backend: BotBackend): EventDeps {
  const client = getFeishu();
  return { sender: client, backend, botOpenId: () => client.getBotOpenId() };
}

export { handleMessageEvent } from "./events";
export { directBackend, httpBackend } from "./backend";
export { startAlertPusher } from "./watch";
export { startDigest } from "./agent";
