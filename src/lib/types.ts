export type Platform = "douyin" | "xiaohongshu" | "kuaishou" | "bilibili";

export type TimeRange =
  | { type: "relative"; days: number }
  | { type: "absolute"; from: string; to: string }; // YYYY-MM-DD，含首尾

export type TaskConfig = {
  platforms: Platform[];
  keywords: string[];
  match: "any" | "all";
  time: TimeRange;
  followers?: { min?: number; max?: number };
  engagement?: { minLikes?: number; minComments?: number };
  /** 高频复投阈值 N，默认 2 */
  repeatThreshold: number;
  /** 每个 平台×关键词 最多翻页数 */
  maxPages: number;
  /** 判定为"投放内容"的最低置信度 */
  minConfidence: number;
};

export const DEFAULT_CONFIG = {
  match: "any",
  repeatThreshold: 2,
  maxPages: 3,
  minConfidence: 0.5,
} as const;

/** 平台适配层输出的统一结构 */
export type NormPost = {
  platform: Platform;
  postId: string;
  url: string;
  title: string;
  hashtags: string[];
  publishedAt: number; // ms
  likes: number;
  comments: number;
  plays: number;
  accountUid: string;
  accountName: string;
  accountUrl: string;
  followers: number | null; // 搜索结果里没有则为 null，之后补
};

export type SearchPage = {
  posts: NormPost[];
  hasMore: boolean;
  next: Record<string, string | number>;
};

export type Progress = {
  stage?: string;
  calls?: number;
  postsSeen?: number;
  postsMatched?: number;
  accounts?: number;
  note?: string;
  newAccounts?: number;
  newRepeat?: number;
  repeatAccounts?: number;
};
