import type { Platform, SearchPage } from "../types";
import { searchDouyin } from "./douyin";
import { searchXhs, getXhsFollowers } from "./xiaohongshu";
import { searchKuaishou, getKuaishouFollowers } from "./kuaishou";
import { searchBilibili, getBilibiliFollowers } from "./bilibili";

export type Searcher = (kw: string, days: number, next: Record<string, string | number> | null, taskId: number) => Promise<SearchPage>;
export type FollowersFn = (uid: string, taskId: number) => Promise<number | null>;

export const PLATFORM_IDS: Platform[] = ["douyin", "xiaohongshu", "kuaishou", "bilibili"];

export const PLATFORMS: Record<Platform, { name: string; search: Searcher; followers?: FollowersFn }> = {
  douyin: { name: "抖音", search: searchDouyin }, // 搜索结果自带粉丝数
  xiaohongshu: { name: "小红书", search: searchXhs, followers: getXhsFollowers },
  kuaishou: { name: "快手", search: searchKuaishou, followers: getKuaishouFollowers },
  bilibili: { name: "B站", search: searchBilibili, followers: getBilibiliFollowers },
};
