import { tikhub, BudgetExceededError } from "../tikhub/client";
import { CircuitOpenError } from "../tikhub/limiter";
import type { NormPost, SearchPage } from "../types";

export function xhsTimeFilter(days: number): string {
  if (days <= 1) return "一天内";
  if (days <= 7) return "一周内";
  if (days <= 180) return "半年内";
  return "不限";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseXhsSearch(res: any): SearchPage {
  const outer = res?.data ?? {}; // 翻页字段在外层
  const d = outer.data ?? {};
  const posts: NormPost[] = [];
  for (const it of d.items ?? []) {
    const n = it?.note;
    if (it?.model_type !== "note" || !n?.id || !n.user?.userid) continue;
    const title = String(n.title ?? n.display_title ?? n.desc ?? "");
    posts.push({
      platform: "xiaohongshu",
      postId: String(n.id),
      url: `https://www.xiaohongshu.com/explore/${n.id}`,
      title: [title, n.desc && n.desc !== title ? n.desc : ""].filter(Boolean).join(" "),
      hashtags: [],
      publishedAt: Number(n.timestamp) * 1000,
      likes: Number(n.liked_count ?? 0),
      comments: Number(n.comments_count ?? 0),
      plays: 0,
      accountUid: String(n.user.userid),
      accountName: String(n.user.nickname ?? ""),
      accountUrl: `https://www.xiaohongshu.com/user/profile/${n.user.userid}`,
      followers: null, // 搜索结果不含粉丝数，需 getXhsFollowers 补
    });
  }
  const hasMore = outer.next_page != null && outer.next_page > (outer.page ?? 0) && posts.length > 0;
  return {
    posts,
    hasMore,
    next: hasMore
      ? { page: outer.next_page, search_id: outer.search_id ?? "", search_session_id: outer.search_session_id ?? "" }
      : {},
  };
}

export async function searchXhs(
  keyword: string,
  days: number,
  next: Record<string, string | number> | null,
  taskId: number,
): Promise<SearchPage> {
  const res = await tikhub().request({
    method: "GET",
    path: "/api/v1/xiaohongshu/app_v2/search_notes",
    platform: "xiaohongshu",
    taskId,
    ttlMs: 60 * 60_000,
    query: {
      keyword,
      page: next?.page ?? 1,
      sort_type: "time_descending",
      note_type: "不限",
      time_filter: xhsTimeFilter(days),
      search_id: (next?.search_id as string) || undefined,
      search_session_id: (next?.search_session_id as string) || undefined,
    },
  });
  return parseXhsSearch(res);
}

/** 补粉丝数：24h 缓存。失败返回 null，不中断任务。 */
export async function getXhsFollowers(userId: string, taskId: number): Promise<number | null> {
  try {
    const res: any = await tikhub().request({
      method: "GET",
      path: "/api/v1/xiaohongshu/app_v2/get_user_info",
      platform: "xiaohongshu",
      taskId,
      ttlMs: 24 * 3600_000,
      query: { user_id: userId },
    });
    const fans = res?.data?.data?.fans;
    return typeof fans === "number" ? fans : null;
  } catch (e) {
    if (e instanceof BudgetExceededError || e instanceof CircuitOpenError) throw e;
    return null;
  }
}
