// 飞书开放平台最小客户端：只用到 鉴权 / 发消息 / 回复 / 上传文件 / 机器人信息。
import type { Card, Sender } from "./types";

type Cfg = { appId: string; appSecret: string; baseUrl: string };

export function feishuConfigFromEnv(env: Record<string, string | undefined> = process.env): Cfg {
  const appId = env.FEISHU_APP_ID, appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID / FEISHU_APP_SECRET（见 .env.example）");
  // 国际版 Lark 用 https://open.larksuite.com
  return { appId, appSecret, baseUrl: env.FEISHU_BASE_URL || "https://open.feishu.cn" };
}

export class FeishuClient implements Sender {
  private token = "";
  private tokenExp = 0;
  private botOpenId: string | null | undefined;

  constructor(private cfg: Cfg, private f: typeof fetch = fetch) {}

  private async tenantToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExp - 60_000) return this.token;
    const r = await this.f(`${this.cfg.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.cfg.appId, app_secret: this.cfg.appSecret }),
    });
    const j = (await r.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number };
    if (j.code !== 0 || !j.tenant_access_token) throw new Error(`飞书鉴权失败：${j.msg}`);
    this.token = j.tenant_access_token;
    this.tokenExp = Date.now() + (j.expire ?? 7200) * 1000;
    return this.token;
  }

  private async call(path: string, init: RequestInit): Promise<{ code: number; msg: string; data?: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const token = await this.tenantToken();
    const r = await this.f(`${this.cfg.baseUrl}/open-apis${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const j = await r.json();
    if (j.code !== 0) throw new Error(`飞书接口错误 ${j.code}：${j.msg}`);
    return j;
  }

  private send(chatId: string, msgType: string, content: unknown, replyTo?: string) {
    const body = JSON.stringify({ msg_type: msgType, content: JSON.stringify(content), ...(replyTo ? {} : { receive_id: chatId }) });
    const path = replyTo ? `/im/v1/messages/${replyTo}/reply` : "/im/v1/messages?receive_id_type=chat_id";
    return this.call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  }

  async text(chatId: string, text: string, replyTo?: string) { await this.send(chatId, "text", { text }, replyTo); }
  async card(chatId: string, card: Card, replyTo?: string): Promise<string | void> {
    const j = await this.send(chatId, "interactive", card, replyTo);
    return j.data?.message_id as string | undefined;
  }

  /** 更新应用自己发的卡片（PATCH /im/v1/messages/:id）。卡片 config 需带 update_multi:true，见 cards.ts 的 updatable。 */
  async update(messageId: string, card: Card) {
    await this.call(`/im/v1/messages/${messageId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: JSON.stringify(card) }) });
  }

  async file(chatId: string, name: string, data: Buffer, replyTo?: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    const fileType = ext === "pdf" ? "pdf" : ext === "xlsx" || ext === "xls" ? "xls" : "stream";
    const form = new FormData();
    form.set("file_type", fileType);
    form.set("file_name", name);
    form.set("file", new Blob([new Uint8Array(data)]), name);
    const up = await this.call("/im/v1/files", { method: "POST", body: form });
    await this.send(chatId, "file", { file_key: up.data.file_key }, replyTo);
  }

  /** 机器人自己的 open_id，用于判断群里是否 @ 了它；取不到时返回 null（退化为"有人被 @ 即响应"）。 */
  async getBotOpenId(): Promise<string | null> {
    if (this.botOpenId !== undefined) return this.botOpenId;
    try {
      const j = await this.call("/bot/v3/info", { method: "GET" });
      this.botOpenId = ((j as any).bot?.open_id as string | undefined) ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch {
      this.botOpenId = null;
    }
    return this.botOpenId;
  }
}
