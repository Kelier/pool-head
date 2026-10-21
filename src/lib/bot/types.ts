// 与传输层无关的机器人内核类型。飞书只是其中一个入口，换成企微/钉钉/Slack 只需实现 Sender + 事件适配。
export type Role = "admin" | "member" | "none";
export type Card = Record<string, unknown>;

export interface Sender {
  text(chatId: string, text: string, replyTo?: string): Promise<void>;
  /** 返回消息 id（若平台提供），供 update 原地刷新 */
  card(chatId: string, card: Card, replyTo?: string): Promise<string | void>;
  file(chatId: string, name: string, data: Buffer, replyTo?: string): Promise<void>;
  /** 可选：原地更新已发出的卡片（“思考中…”占位 → 最终答案）。不支持的平台不实现即可，会回退为发新消息。 */
  update?(messageId: string, card: Card): Promise<void>;
}

/** 长耗时回答的进度展示：首次调用发出占位卡片，之后原地刷新。 */
export interface Progress {
  step(text: string): Promise<void>;
}

/** 会触发 TikHub 计费的写操作统一走 Backend，保证全局只有一个进程在限速（见 docs/FEISHU_BOT.md）。 */
export interface BotBackend {
  runCompetitor(competitorId: number, days: number): Promise<{ id: number; estimate: number }>;
}

export type BotCtx = {
  userId: string;
  chatId: string;
  chatType: "p2p" | "group";
  role: Role;
  /** Web 控制台的公开地址，用于卡片里的"查看详情"链接 */
  baseUrl: string;
  sender: Sender;
  backend: BotBackend;
};

export type Reply = { text?: string; card?: Card; file?: { name: string; data: Buffer } };

export type Command = {
  names: string[];
  usage: string;
  desc: string;
  role: "member" | "admin";
  run: (args: string[], ctx: BotCtx) => Promise<Reply>;
};
