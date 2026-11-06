import type { Plan } from "./tools";

export type CrawlDraft = NonNullable<Plan["crawlDraft"]> & { keywords?: string; platforms?: string };

/** 读取用于补配置的短句，保留原始抓取范围。 */
export function fillCrawlDraft(text: string, draft: CrawlDraft): CrawlDraft | undefined {
  const fields = /(?:监测词|关键词|平台)\s*(?:就用|用|是|为|[:：])?\s*/g;
  const matches = [...text.matchAll(fields)];
  const prefix = text.slice(0, matches[0]?.index).trim().replace(/[，,、；;。]+$/, "").trim();
  const barePlatforms = /^(?:抖音|小红书|快手|B站|视频号|公众号)(?:(?:和|与|以及|[、，,])(?:抖音|小红书|快手|B站|视频号|公众号))*$/i;
  if ((!matches.length && !prefix) || (prefix && !barePlatforms.test(prefix))) return undefined;
  const next = { ...draft, ...(prefix && { platforms: prefix.replace(/和|以及|与/g, "、") }) };
  for (const [i, match] of matches.entries()) {
    const value = text.slice(match.index + match[0].length, matches[i + 1]?.index)
      .replace(/^[\s，,、；;]+|[\s，,、；;。！!]+$/g, "");
    if (!value) continue;
    if (match[0].startsWith("平台")) next.platforms = value.replace(/和|以及|与/g, "、");
    else next.keywords = value;
  }
  return next;
}

/** 只询问当前缺失的配置，并回显已捕捉的时间。 */
export function describeCrawlDraft(draft: CrawlDraft): string {
  const window = draft.from && draft.to ? `，日期 ${draft.from} 至 ${draft.to}` : draft.days ? `，近 ${draft.days} 天` : "";
  const missing = [
    !draft.platforms && "平台（如「平台：抖音、小红书」）",
    !draft.keywords && `监测关键词（如「关键词：${draft.target}」）`,
  ].filter(Boolean).join("和");
  return `当前未配置竞品「${draft.target}」。已记下抓取请求${window}。如需新增监测，请补充${missing}。`;
}
