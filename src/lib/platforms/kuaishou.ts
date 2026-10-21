import { tikhub, BudgetExceededError } from "../tikhub/client";
import { CircuitOpenError } from "../tikhub/limiter";
import type { NormPost, SearchPage } from "../types";

// 快手综合搜索 publish_time 仅支持 all/one_day/one_week/one_month，取 ≥ 所需天数的最小档，精确区间由本地过滤。
export function kuaishouTimeFilter(days: number): string {
  if (days <= 1) return "one_day";
  if (days <= 7) return "one_week";
  if (days <= 30) return "one_month";
  return "all";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseKuaishouSearch(res: any): SearchPage {
  const data = res?.data ?? {};
  const posts: NormPost[] = [];
  for (const m of data.mixFeeds ?? []) {
    const f = m?.feed;
    if (!f?.user_id || !f.timestamp) continue;
    // photo_id 是 >2^53 的数字，JSON.parse 会丢精度；share_info 里的 photoId/userId 是网页端使用的字符串 ID
    const share = new URLSearchParams(String(f.share_info ?? ""));
    const photoId = share.get("photoId");
    if (!photoId) continue;
    const webUid = share.get("userId");
    const caption = String(f.caption ?? "");
    posts.push({
      platform: "kuaishou",
      postId: photoId,
      url: `https://www.kuaishou.com/short-video/${photoId}`,
      title: caption,
      hashtags: [...caption.matchAll(/#([^\s#@]+)/g)].map((x) => x[1]),
      publishedAt: Number(f.timestamp), // 已是毫秒
      likes: Number(f.like_count ?? 0),
      comments: Number(f.comment_count ?? 0),
      plays: Number(f.view_count ?? 0),
      accountUid: String(f.user_id), // 数字 userId，稳定；可直接用于 fetch_one_user_v2
      accountName: String(f.user_name ?? ""),
      accountUrl: webUid ? `https://www.kuaishou.com/profile/${webUid}` : "",
      followers: null, // 搜索结果不含粉丝数，需 getKuaishouFollowers 补
    });
  }
  // pcursor 为下一页游标（"1","2",…），无更多时为空或 "no_more"；接口无显式结束标记，靠空页终止
  const pc = data.pcursor;
  const hasMore = pc != null && pc !== "" && pc !== "no_more" && posts.length > 0;
  return { posts, hasMore, next: hasMore ? { pcursor: String(pc) } : {} };
}

export async function searchKuaishou(
  keyword: string,
  days: number,
  next: Record<string, string | number> | null,
  taskId: number,
): Promise<SearchPage> {
  const res = await tikhub().request({
    method: "GET",
    path: "/api/v1/kuaishou/app/search_comprehensive",
    platform: "kuaishou",
    taskId,
    ttlMs: 60 * 60_000,
    query: {
      keyword,
      sort_type: "newest",
      publish_time: kuaishouTimeFilter(days),
      pcursor: (next?.pcursor as string) || undefined,
    },
  });
  return parseKuaishouSearch(res);
}

/** 补粉丝数：24h 缓存。失败返回 null，不中断任务。 */
export async function getKuaishouFollowers(userId: string, taskId: number): Promise<number | null> {
  try {
    const res: any = await tikhub().request({
      method: "GET",
      path: "/api/v1/kuaishou/app/fetch_one_user_v2",
      platform: "kuaishou",
      taskId,
      ttlMs: 24 * 3600_000,
      query: { user_id: userId },
    });
    const fan = res?.data?.userProfile?.ownerCount?.fan;
    return typeof fan === "number" ? fan : null;
  } catch (e) {
    if (e instanceof BudgetExceededError || e instanceof CircuitOpenError) throw e;
    return null;
  }
}
