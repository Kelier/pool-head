import { tikhub } from "../tikhub/client";
import type { NormPost, SearchPage } from "../types";

// 抖音视频搜索 V2。publish_time 只支持 0/1/7/180 档位，取 ≥ 所需天数的最小档，精确区间由本地过滤。
export function douyinPublishBucket(days: number): string {
  if (days <= 1) return "1";
  if (days <= 7) return "7";
  if (days <= 180) return "180";
  return "0";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseDouyinSearch(res: any): SearchPage {
  const data = res?.data ?? {};
  const posts: NormPost[] = [];
  for (const b of data.business_data ?? []) {
    const a = b?.data?.aweme_info;
    if (!a?.aweme_id || !a.author?.sec_uid) continue; // 非视频卡片
    const st = a.statistics ?? {};
    posts.push({
      platform: "douyin",
      postId: String(a.aweme_id),
      url: `https://www.douyin.com/video/${a.aweme_id}`,
      title: String(a.desc ?? ""),
      hashtags: (a.text_extra ?? []).map((t: any) => t?.hashtag_name).filter(Boolean),
      publishedAt: Number(a.create_time) * 1000,
      likes: Number(st.digg_count ?? 0),
      comments: Number(st.comment_count ?? 0),
      plays: Number(st.play_count ?? 0), // 搜索结果通常为 0，不能作为过滤依据
      accountUid: String(a.author.sec_uid),
      accountName: String(a.author.nickname ?? ""),
      accountUrl: `https://www.douyin.com/user/${a.author.sec_uid}`,
      followers: typeof a.author.follower_count === "number" ? a.author.follower_count : null,
    });
  }
  const np = data.business_config?.next_page;
  return {
    posts,
    hasMore: Boolean(data.business_config?.has_more) && Boolean(np),
    next: np ? { cursor: np.cursor ?? 0, search_id: np.search_id ?? "" } : {},
  };
}

export async function searchDouyin(
  keyword: string,
  days: number,
  next: Record<string, string | number> | null,
  taskId: number,
): Promise<SearchPage> {
  const res = await tikhub().request({
    method: "POST",
    path: "/api/v1/douyin/search/fetch_video_search_v2",
    platform: "douyin",
    taskId,
    ttlMs: 60 * 60_000,
    body: {
      keyword,
      sort_type: "2", // 最新发布，便于遇到早于起点的内容就停止翻页
      publish_time: douyinPublishBucket(days),
      cursor: next?.cursor ?? 0,
      search_id: next?.search_id ?? "",
    },
  });
  return parseDouyinSearch(res);
}
