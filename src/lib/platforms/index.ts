import type { NormPost, Platform, SearchPage } from "../types";
import { searchDouyin } from "./douyin";
import { searchXhs, getXhsFollowers } from "./xiaohongshu";
import { searchKuaishou, getKuaishouFollowers } from "./kuaishou";
import { searchBilibili, getBilibiliFollowers } from "./bilibili";
import { searchWechatChannels, resolveChannelsAccount, getChannelsFollowers, channelsFansEnabled } from "./wechat_channels";
import { searchWechatMp } from "./wechat_mp";

export type Searcher = (kw: string, days: number, next: Record<string, string | number> | null, taskId: number) => Promise<SearchPage>;
export type FollowersFn = (uid: string, taskId: number) => Promise<number | null>;

export type ResolveFn = (post: NormPost, taskId: number) => Promise<{ uid: string; name?: string; url?: string } | null>;

export type PlatformDef = {
  name: string;
  search: Searcher;
  followers?: FollowersFn;
  /** 搜索结果里没有作者的稳定 ID 时，用一条命中作品换出真实账号（会花调用）。失败返回 null，沿用搜索时的临时 ID */
  resolveAccount?: ResolveFn;
  /** 每个命中账号补资料需要的调用数（仅用于预估成本）。缺省：有 followers 则 1，否则 0 */
  enrichCalls?: () => number;
  /** 搜索结果没有可靠的互动数据：任务里的"最低点赞 / 评论"过滤对该平台不生效，否则会把全部内容滤掉 */
  noEngagement?: boolean;
};

export const PLATFORM_IDS: Platform[] = ["douyin", "xiaohongshu", "kuaishou", "bilibili", "wechat_channels", "wechat_mp"];

export const PLATFORMS: Record<Platform, PlatformDef> = {
  douyin: { name: "抖音", search: searchDouyin }, // 搜索结果自带粉丝数
  xiaohongshu: { name: "小红书", search: searchXhs, followers: getXhsFollowers },
  kuaishou: { name: "快手", search: searchKuaishou, followers: getKuaishouFollowers },
  bilibili: { name: "B站", search: searchBilibili, followers: getBilibiliFollowers },
  // 视频号：换账号 1 次 + 补粉丝 1 次（WECHAT_CHANNELS_FANS=off 时只有 1 次）
  wechat_channels: { name: "视频号", search: searchWechatChannels, resolveAccount: resolveChannelsAccount, followers: getChannelsFollowers, enrichCalls: () => (channelsFansEnabled() ? 2 : 1), noEngagement: true },
  // 公众号：粉丝数微信不提供，搜索结果也没有阅读 / 点赞数
  wechat_mp: { name: "公众号", search: searchWechatMp, noEngagement: true },
};
