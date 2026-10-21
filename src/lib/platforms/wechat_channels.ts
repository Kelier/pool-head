// 视频号：搜索 → 作品；作者账号需要额外换出。
//
// 搜索结果里只有作者昵称和头像地址，没有稳定的账号 ID。所以分两步：
//   1. 搜索时用「头像文件指纹」作临时账号 ID（同一作者同一头像下一致），这样即使后面补账号失败，同一作者的作品仍会聚在一起；
//   2. 命中（通过关键词判定）之后，每个临时账号用一条作品调 fetch_video_detail 换出真实的 finder username（v2_…@finder）作为稳定 ID，
//      再用 fetch_user_profile 补粉丝数。只对命中的账号做，不会为每条搜索结果花钱。
//
// 作品 ID 用 hashDocID（两次相隔数分钟的"最热榜"查询里 10/10 一致）；exportId 文档说会过期，仅在缺 hashDocID 时兜底。
import { BudgetExceededError, tikhub } from "../tikhub/client";
import { CircuitOpenError } from "../tikhub/limiter";
import type { NormPost, SearchPage } from "../types";
import { flattenItems, pageInfo, parseCount, stripEm, wechatPublishTime, wechatSearch } from "./wechat";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PROVISIONAL = "av:";

/** 头像地址 → 临时账号 ID。形如 https://wx.qlogo.cn/finderhead/ver_1/<指纹>/132；取不到头像就退回昵称。 */
export function provisionalUid(iconUrl: string, nickname: string): string {
  const m = /\/finderhead\/ver_\d+\/([^/?#]+)/.exec(iconUrl);
  return m ? `${PROVISIONAL}${m[1]}` : `nick:${nickname}`;
}

export function parseChannelsSearch(res: any): SearchPage {
  const posts: NormPost[] = [];
  for (const it of flattenItems(res)) {
    const id = String(it?.hashDocID ?? it?.exportId ?? "");
    const nick = String(it?.source?.title ?? "").trim();
    if (!id || !nick || !it.pubTime) continue;
    let nonce = "";
    try { nonce = String(JSON.parse(it.jumpInfo?.extInfo ?? "{}").feedNonceId ?? ""); } catch { /* 无 nonce 不影响换账号，只是命中率略低 */ }
    const title = stripEm(String(it.title ?? ""));
    posts.push({
      platform: "wechat_channels",
      postId: id,
      url: "", // 搜索结果没有公开网页链接（分享链接需另付费生成），界面里只显示标题
      title,
      hashtags: [...title.matchAll(/#([^#\s@]+)/g)].map((x) => x[1]),
      publishedAt: Number(it.pubTime) * 1000,
      likes: parseCount(it.likeNum), // 常缺失；有时是 "10万+" 这样的字符串
      comments: 0, // 搜索结果无评论数 / 播放数
      plays: 0,
      accountUid: provisionalUid(String(it.source?.iconUrl ?? ""), nick),
      accountName: nick,
      accountUrl: "",
      followers: null,
      ...(it.exportId ? { ref: { exportId: String(it.exportId), ...(nonce ? { nonceId: nonce } : {}) } } : {}),
    });
  }
  return { posts, ...pageInfo(res, posts.length) };
}

export async function searchWechatChannels(keyword: string, days: number, next: Record<string, string | number> | null, taskId: number): Promise<SearchPage> {
  const res = await wechatSearch(
    "/api/v1/wechat_search/v2/fetch_search_videos",
    { keyword: keyword.slice(0, 100), sort: "latest", publish_time: wechatPublishTime(days), ...(next?.cursor ? { cursor: String(next.cursor) } : {}) },
    "wechat_channels", taskId,
  );
  return res ? parseChannelsSearch(res) : { posts: [], hasMore: false, next: {} };
}

/** 用一条作品换出作者的真实账号。失败返回 null（沿用临时 ID，不中断任务）。 */
export async function resolveChannelsAccount(post: NormPost, taskId: number): Promise<{ uid: string; name?: string } | null> {
  const exportId = post.ref?.exportId;
  if (!exportId) return null;
  try {
    const res: any = await tikhub().request({
      method: "POST",
      path: "/api/v1/wechat_channels/v2/fetch_video_detail",
      platform: "wechat_channels",
      taskId,
      ttlMs: 24 * 3600_000,
      body: { export_id: exportId, ...(post.ref?.nonceId ? { object_nonce_id: post.ref.nonceId } : {}), raw: false },
    });
    const username = res?.data?.username;
    if (typeof username !== "string" || !username.startsWith("v2_")) return null;
    const nick = typeof res.data.nickname === "string" && res.data.nickname.trim() ? res.data.nickname.trim() : undefined;
    return { uid: username, name: nick };
  } catch (e) {
    if (e instanceof BudgetExceededError || e instanceof CircuitOpenError) throw e;
    return null;
  }
}

/** 是否补粉丝数。WECHAT_CHANNELS_FANS=off 可关闭，省掉每个账号 1 次调用。 */
export const channelsFansEnabled = (env: Record<string, string | undefined> = process.env) => (env.WECHAT_CHANNELS_FANS ?? "on").toLowerCase() !== "off";

/**
 * 补粉丝数（24h 缓存）。注意：接口对部分账号返回 0，而这几乎一定是"取不到"而不是真的 0 粉
 * （实测一个有 1308 条作品的账号返回 0），所以 0 一律当作未知；临时 ID 查不了，直接 null。
 */
export async function getChannelsFollowers(username: string, taskId: number): Promise<number | null> {
  if (!channelsFansEnabled() || !username.startsWith("v2_")) return null;
  try {
    const res: any = await tikhub().request({
      method: "POST",
      path: "/api/v1/wechat_channels/v2/fetch_user_profile",
      platform: "wechat_channels",
      taskId,
      ttlMs: 24 * 3600_000,
      body: { username, raw: false },
    });
    const n = Number(res?.data?.fans_count);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    if (e instanceof BudgetExceededError || e instanceof CircuitOpenError) throw e;
    return null;
  }
}
