import type { NormPost, TaskConfig } from "./types";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

export type Classification = {
  matchedKeywords: string[];
  confidence: number;
  reasons: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 关键词拆成 英文/数字词 与 中文片段，全部出现即命中（"libtv导演台" 能命中 "LibTV 打通…3D 导演台"）。 */
const tokens = (k: string) => k.toLowerCase().match(/[a-z0-9]+|[一-鿿]+/g) ?? [k.toLowerCase()];
const hits = (text: string, k: string) => tokens(k).every((t) => text.includes(t));

/** 返回 null = 关键词条件不满足或命中排除词（直接丢弃）。 */
export function classify(
  post: NormPost,
  cfg: Pick<TaskConfig, "keywords" | "match">,
  rules: Settings["rules"] = DEFAULT_SETTINGS.rules,
): Classification | null {
  const text = norm([post.title, post.text ?? "", ...post.hashtags].join(" "));
  const hit = cfg.keywords.filter((k) => hits(text, k));
  if (cfg.match === "all" ? hit.length !== cfg.keywords.length : hit.length === 0) return null;
  if (rules.exclude.some((w) => w && text.includes(norm(w)))) return null;

  const reasons = [`命中关键词：${hit.join("、")}`];
  let confidence = 0.5;
  if (post.hashtags.some((h) => hit.some((k) => hits(norm(h), k)))) {
    confidence += 0.1;
    reasons.push("话题标签命中");
  }
  for (const r of rules.promo) {
    if (r.words.some((w) => text.includes(norm(w)))) {
      confidence += r.weight;
      reasons.push(r.label);
    }
  }
  return { matchedKeywords: hit, confidence: Math.min(1, Number(confidence.toFixed(2))), reasons };
}

export function frequencyLabel(count: number): string {
  if (count <= 1) return "单次试投";
  if (count <= 3) return "2-3次复投";
  return "深度绑定";
}
