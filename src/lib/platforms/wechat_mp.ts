// 公众号：搜一搜「文章」垂类 → 文章。
//
// · 账号 ID 用文章链接里的 __biz（同一公众号恒定）。搜索结果里没有 gh_ 用户名，也没有头像。
// · 搜索结果没有阅读 / 点赞 / 在看数，粉丝数微信也不提供任何接口 → likes/comments/plays 记 0，followers 为 null（界面显示"未知"，
//   不参与粉丝过滤）。互动过滤对本平台不生效（见 platforms/index.ts 的 noEngagement），否则会把全部文章滤掉。
// · 判定用的文本 = 标题 + 摘要（摘要正是关键词命中处附近的片段），所以把摘要放进 NormPost.text 参与判定、但不入库。
import type { NormPost, SearchPage } from "../types";
import { flattenItems, pageInfo, stripEm, wechatPublishTime, wechatSearch } from "./wechat";

/* eslint-disable @typescript-eslint/no-explicit-any */

const q = (url: string, key: string) => {
  const m = new RegExp(`[?&]${key}=([^&#]+)`).exec(url);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
};

export function parseMpSearch(res: any): SearchPage {
  const posts: NormPost[] = [];
  for (const it of flattenItems(res)) {
    const url = String(it?.doc_url ?? "");
    const biz = q(url, "__biz"), mid = q(url, "mid"), idx = q(url, "idx") || "1", sn = q(url, "sn");
    const name = String(it?.source?.title ?? "").trim();
    const ts = Number(it?.timestamp ?? it?.date);
    if (!biz || !mid || !name || !ts) continue;
    // 规范化链接：去掉 chksm / #rd 等追踪参数，保留能直接打开所需的 biz+mid+idx+sn
    const link = `https://mp.weixin.qq.com/s?__biz=${encodeURIComponent(biz)}&mid=${mid}&idx=${idx}${sn ? `&sn=${sn}` : ""}`;
    posts.push({
      platform: "wechat_mp",
      postId: `${biz}_${mid}_${idx}`,
      url: link,
      title: stripEm(String(it.title ?? "")),
      text: stripEm(String(it.desc ?? "")),
      hashtags: [],
      publishedAt: ts * 1000,
      likes: 0,
      comments: 0,
      plays: 0,
      accountUid: biz,
      accountName: name,
      accountUrl: `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(biz)}&scene=124#wechat_redirect`,
      followers: null,
    });
  }
  return { posts, ...pageInfo(res, posts.length) };
}

export async function searchWechatMp(keyword: string, days: number, next: Record<string, string | number> | null, taskId: number): Promise<SearchPage> {
  const res = await wechatSearch(
    "/api/v1/wechat_search/v2/fetch_search",
    { keyword: keyword.slice(0, 100), business_type: "article", sort: "latest", publish_time: wechatPublishTime(days), ...(next?.cursor ? { cursor: String(next.cursor) } : {}) },
    "wechat_mp", taskId,
  );
  return res ? parseMpSearch(res) : { posts: [], hasMore: false, next: {} };
}
