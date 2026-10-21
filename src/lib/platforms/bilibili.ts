import { tikhub, BudgetExceededError } from "../tikhub/client";
import { CircuitOpenError } from "../tikhub/limiter";
import type { NormPost, SearchPage } from "../types";

const PAGE_SIZE = 20;

/** B站支持任意 10 位时间戳区间（pubtime_begin_s/end_s），可精确到秒。 */
export function bilibiliTimeRange(days: number, nowMs = Date.now()): { begin: number; end: number } {
  const end = Math.floor(nowMs / 1000);
  return { begin: end - Math.ceil(days) * 86400, end };
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseBilibiliSearch(res: any): SearchPage {
  const d = res?.data?.data ?? {}; // 外层是 TikHub 包装，内层是 B站原始 {code, data}
  const posts: NormPost[] = [];
  for (const v of d.result ?? []) {
    if (v?.type !== "video" || !v.bvid || !v.mid) continue;
    posts.push({
      platform: "bilibili",
      postId: String(v.bvid),
      url: `https://www.bilibili.com/video/${v.bvid}`,
      title: stripHtml(String(v.title ?? "")),
      hashtags: String(v.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      publishedAt: Number(v.pubdate) * 1000,
      likes: Number(v.like ?? 0),
      comments: Number(v.review ?? 0),
      plays: Number(v.play ?? 0),
      accountUid: String(v.mid),
      accountName: String(v.author ?? ""),
      accountUrl: `https://space.bilibili.com/${v.mid}`,
      followers: null, // 搜索结果不含粉丝数，需 getBilibiliFollowers 补
    });
  }
  const page = Number(d.page ?? 1);
  const hasMore = d.numPages != null && page < Number(d.numPages) && posts.length > 0;
  return { posts, hasMore, next: hasMore ? { page: page + 1 } : {} };
}

export async function searchBilibili(
  keyword: string,
  days: number,
  next: Record<string, string | number> | null,
  taskId: number,
): Promise<SearchPage> {
  const { begin, end } = bilibiliTimeRange(days);
  const res = await tikhub().request({
    method: "GET",
    path: "/api/v1/bilibili/web/fetch_general_search",
    platform: "bilibili",
    taskId,
    ttlMs: 60 * 60_000,
    query: {
      keyword,
      order: "pubdate", // 最新发布
      page: next?.page ?? 1,
      page_size: PAGE_SIZE,
      pubtime_begin_s: begin,
      pubtime_end_s: end,
    },
  });
  return parseBilibiliSearch(res);
}

/** 补粉丝数：24h 缓存。失败返回 null，不中断任务。 */
export async function getBilibiliFollowers(mid: string, taskId: number): Promise<number | null> {
  try {
    const res: any = await tikhub().request({
      method: "GET",
      path: "/api/v1/bilibili/web/fetch_user_relation_stat",
      platform: "bilibili",
      taskId,
      ttlMs: 24 * 3600_000,
      query: { uid: mid },
    });
    const f = res?.data?.follower;
    return typeof f === "number" ? f : null;
  } catch (e) {
    if (e instanceof BudgetExceededError || e instanceof CircuitOpenError) throw e;
    return null;
  }
}
