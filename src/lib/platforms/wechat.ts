// 视频号 / 公众号共用：二者都走 TikHub 的「微信搜一搜」V2 接口（POST，按次 $0.01，响应慢，超时需 ≥30s）。
//
// 真实调用核对出的几个坑（见 tests/fixtures/wechat_*.json，均为真实响应的裁剪）：
//  1. 结果为空时上游返回 HTTP 400（不扣费），不是 200+空列表 → 必须当作"没有结果"，不能让任务失败。
//  2. 时间档位只有 day/week/half_year/all；而 sort=latest 叠加 publish_time=day 实测恒 400，所以最小用 week，精确区间由本地过滤。
//  3. 请勿传 raw=false（精简模式实测不稳定）；用默认原始结构自行解析。
//  4. docID / feedNonceId 等是 64 位大整数，只在 JSON 里以字符串出现；这里也只按字符串处理，不经过 Number。
import { TikHubError, tikhub } from "../tikhub/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 取 ≥ 所需天数的最小档位。最小用 week（原因见文件头第 2 条）。 */
export function wechatPublishTime(days: number): "week" | "half_year" | "all" {
  if (days <= 7) return "week";
  if (days <= 183) return "half_year";
  return "all";
}

/** 去掉搜索结果里的 <em> 高亮标签并还原常见实体。 */
export const stripEm = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** "1" / 12 / "1.2万" / "10万+" / "1.5亿" → 数字；认不出返回 0。 */
export function parseCount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const m = /^([\d.]+)\s*(万|亿|w|k)?\+?$/i.exec(String(v ?? "").replace(/[,\s]/g, ""));
  if (!m) return 0;
  const mult = { 万: 1e4, w: 1e4, 亿: 1e8, k: 1e3 }[(m[2] ?? "").toLowerCase() as "万"] ?? 1;
  const n = parseFloat(m[1]) * mult;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 把各个 box / subBox 里的结果项拍平成一个数组（原始响应的结构：data.results.data[].items | .subBoxes[].items）。 */
export function flattenItems(res: any): any[] {
  const out: any[] = [];
  for (const b of res?.data?.results?.data ?? []) {
    out.push(...(b?.items ?? []));
    for (const sb of b?.subBoxes ?? []) out.push(...(sb?.items ?? []));
  }
  return out;
}

/** 翻页：continue_flag 为真且有 cursor、且本页有结果才继续。 */
export function pageInfo(res: any, count: number): { hasMore: boolean; next: Record<string, string> } {
  const d = res?.data ?? {};
  const hasMore = !!d.continue_flag && typeof d.cursor === "string" && d.cursor !== "" && count > 0;
  return { hasMore, next: hasMore ? { cursor: d.cursor } : {} };
}

/**
 * 发起搜索请求。HTTP 400 视为"没有结果"返回 null（鉴权 / 预算 / 熔断 / 网络错误照常抛出）。
 * 代价：真正的参数错误也会被当成空结果，所以打一行日志留痕。
 */
export async function wechatSearch(path: string, body: Record<string, unknown>, platform: string, taskId: number): Promise<any | null> {
  try {
    return await tikhub().request({ method: "POST", path, platform, taskId, ttlMs: 60 * 60_000, body });
  } catch (e) {
    if (e instanceof TikHubError && e.status === 400) {
      console.warn(`[${platform}] 搜索返回 400，按无结果处理（关键词「${String(body.keyword).slice(0, 20)}」）`);
      return null;
    }
    throw e;
  }
}
