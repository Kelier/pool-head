// 进度占位卡片：大模型回答要几秒，先发一张“正在…”卡片，随后原地刷新成最终答案，而不是让人干等。
// 平台不支持更新（Sender.update 缺失）或发送失败时静默退化为"没有占位"，最终答案走普通新消息。
import { card } from "../cards";
import type { Card, Progress, Sender } from "../types";

export class ProgressCard implements Progress {
  private id: string | undefined;
  private started = false;

  constructor(private sender: Sender, private chatId: string, private replyTo?: string) {}

  get active() { return this.id !== undefined; }

  async step(text: string) {
    if (!this.sender.update) return;
    const c = card("🤖 处理中", "wathet", [text], { updatable: true });
    if (!this.started) {
      this.started = true;
      this.id = (await this.sender.card(this.chatId, c, this.replyTo).catch(() => undefined)) || undefined;
    } else if (this.id) {
      await this.sender.update(this.id, c).catch(() => {});
    }
  }

  /** 把占位卡替换成最终卡片。没有占位（或更新失败）返回 false，由调用方改发新消息。 */
  async finish(final: Card): Promise<boolean> {
    if (!this.id || !this.sender.update) return false;
    try { await this.sender.update(this.id, final); return true; } catch { return false; }
  }
}
