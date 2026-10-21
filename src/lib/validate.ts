import { DEFAULT_CONFIG, type Platform, type TaskConfig } from "./types";
import { PLATFORM_IDS } from "./platforms";

const PLATFORMS: Platform[] = PLATFORM_IDS;

/** 校验并补默认值；非法输入抛 Error(message)。 */
export function parseTaskConfig(raw: any): TaskConfig { // eslint-disable-line @typescript-eslint/no-explicit-any
  const platforms = (raw?.platforms ?? []).filter((p: string) => PLATFORMS.includes(p as Platform));
  if (!platforms.length) throw new Error("请至少选择一个平台");
  const keywords = [...new Set<string>((raw?.keywords ?? []).map((k: string) => String(k).trim()).filter(Boolean))];
  if (!keywords.length) throw new Error("请至少填写一个关键词");
  if (keywords.length > 10) throw new Error("单任务关键词最多 10 个");

  const t = raw?.time;
  let time: TaskConfig["time"];
  if (t?.type === "absolute") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.from) || !/^\d{4}-\d{2}-\d{2}$/.test(t.to) || t.from > t.to) throw new Error("绝对时间范围不合法");
    time = { type: "absolute", from: t.from, to: t.to };
  } else {
    const days = Number(t?.days ?? 30);
    if (!(days >= 1 && days <= 365)) throw new Error("相对时间需在 1–365 天");
    time = { type: "relative", days };
  }
  const int = (v: unknown, d: number, lo: number, hi: number) => {
    const n = v == null || v === "" ? d : Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`参数超出范围 ${lo}–${hi}`);
    return n;
  };
  const opt = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
  return {
    platforms,
    keywords,
    match: raw?.match === "all" ? "all" : DEFAULT_CONFIG.match,
    time,
    followers: raw?.followers ? { min: opt(raw.followers.min), max: opt(raw.followers.max) } : undefined,
    engagement: raw?.engagement ? { minLikes: opt(raw.engagement.minLikes), minComments: opt(raw.engagement.minComments) } : undefined,
    repeatThreshold: int(raw?.repeatThreshold, DEFAULT_CONFIG.repeatThreshold, 2, 50),
    maxPages: int(raw?.maxPages, DEFAULT_CONFIG.maxPages, 1, 10),
    minConfidence: int(raw?.minConfidence, DEFAULT_CONFIG.minConfidence, 0, 1),
  };
}
