import type { Card } from "./types";

export type Template = "blue" | "wathet" | "turquoise" | "green" | "yellow" | "orange" | "red" | "carmine" | "violet" | "purple" | "indigo" | "grey";

/** 飞书交互卡片（1.0 结构）。正文用 markdown；总大小需 < 30KB，所以列表统一截断。 */
export function card(title: string, template: Template, md: string[], opts: { note?: string; links?: Array<{ text: string; url: string }>; updatable?: boolean } = {}): Card {
  const elements: Array<Record<string, unknown>> = md.filter(Boolean).map((content) => ({ tag: "markdown", content }));
  if (opts.links?.length) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "action",
      actions: opts.links.map((l, i) => ({ tag: "button", text: { tag: "plain_text", content: l.text }, url: l.url, type: i === 0 ? "primary" : "default" })),
    });
  }
  if (opts.note) elements.push({ tag: "note", elements: [{ tag: "plain_text", content: opts.note }] });
  return { config: { wide_screen_mode: true, ...(opts.updatable ? { update_multi: true } : {}) }, header: { title: { tag: "plain_text", content: title }, template }, elements };
}

export const link = (text: string, url: string) => `[${text}](${url})`;
export const trunc = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const fmtN = (n: number | null | undefined) => (n == null ? "未知" : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n));
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const day = (t: number) => new Date(t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
export const MAX_LIST = 10;
