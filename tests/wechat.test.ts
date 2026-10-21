import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gtm-wx-")), "w.db");
process.env.TIKHUB_API_KEY = "test-key";
process.env.TIKHUB_GLOBAL_QPS = "8";

import { db } from "../src/lib/db";
import { runTask, estimateCalls } from "../src/lib/pipeline";
import { accountRows } from "../src/lib/queries";
import { classify } from "../src/lib/classify";
import { parseCount, wechatPublishTime, stripEm } from "../src/lib/platforms/wechat";
import { parseChannelsSearch, provisionalUid, searchWechatChannels, resolveChannelsAccount, getChannelsFollowers } from "../src/lib/platforms/wechat_channels";
import { parseMpSearch, searchWechatMp } from "../src/lib/platforms/wechat_mp";
import { PLATFORM_IDS, PLATFORMS } from "../src/lib/platforms";
import type { TaskConfig } from "../src/lib/types";

// 以下夹具都是 TikHub 真实响应的裁剪（去掉了调试字段）
const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
const chSearch = load("wechat_channels_search.json");
const chHot = load("wechat_channels_search_hot.json");
const mpSearch = load("wechat_mp_search.json");
const detail = load("wechat_channels_detail.json");
const profile = load("wechat_channels_profile.json");

describe("工具函数", () => {
  it("数量解析：数字、字符串、万/亿、10万+", () => {
    expect(["1", 12, "1.2万", "10万+", "1.5亿", "3,456", "", null, "abc", "2k"].map(parseCount)).toEqual([1, 12, 12000, 100000, 150000000, 3456, 0, 0, 0, 2000]);
  });
  it("时间档位：最小用 week（latest+day 实测恒 400），再 half_year，再 all", () => {
    expect([1, 3, 7, 8, 30, 183, 184, 365].map(wechatPublishTime)).toEqual(["week", "week", "week", "half_year", "half_year", "half_year", "all", "all"]);
  });
  it("去掉高亮标签与实体", () => {
    expect(stripEm('被震到了！<em class="highlight">AI视频</em>生成 &amp; &quot;变天&quot;')).toBe('被震到了！AI视频生成 & "变天"');
  });
  it("注册了两个新平台", () => {
    expect(PLATFORM_IDS).toEqual(expect.arrayContaining(["wechat_channels", "wechat_mp"]));
    expect(PLATFORMS.wechat_channels.name).toBe("视频号");
    expect(PLATFORMS.wechat_mp.name).toBe("公众号");
    expect(PLATFORMS.wechat_mp.followers).toBeUndefined(); // 微信不提供公众号粉丝数
  });
});

describe("视频号：解析搜索结果（真实样本）", () => {
  const r = parseChannelsSearch(chSearch);
  it("字段", () => {
    expect(r.posts.length).toBeGreaterThan(0);
    for (const p of r.posts) {
      expect(p.platform).toBe("wechat_channels");
      expect(p.postId).toMatch(/^\d{10,}$/); // hashDocID：数字字符串，不经过 Number
      expect(typeof p.postId).toBe("string");
      expect(p.title).not.toContain("<em");
      expect(p.accountName).toBeTruthy();
      expect(p.accountUid).toMatch(/^(av:|nick:)/); // 搜索阶段只有临时账号
      expect(p.publishedAt).toBeGreaterThan(1e12);
      expect(p.publishedAt).toBeLessThan(1e14);
      expect(p.followers).toBeNull();
      expect(p.url).toBe("");
      expect(p.ref?.exportId).toMatch(/^export\//);
    }
  });
  it("同一作者（同一头像）得到同一个临时账号；头像取不到时退回昵称", () => {
    expect(provisionalUid("https://wx.qlogo.cn/finderhead/ver_1/abcDEF123/132", "张三")).toBe("av:abcDEF123");
    expect(provisionalUid("", "张三")).toBe("nick:张三");
    expect(provisionalUid("https://example.com/x.png", "张三")).toBe("nick:张三");
  });
  it("热门榜里 likeNum 是 \"10万+\" 这样的字符串", () => {
    const hot = parseChannelsSearch(chHot);
    expect(hot.posts.some((p) => p.likes >= 100000)).toBe(true);
  });
  it("翻页：continue_flag + cursor；空页不再翻", () => {
    expect(r.hasMore).toBe(true);
    expect(r.next).toEqual({ cursor: chSearch.data.cursor });
    expect(parseChannelsSearch({ data: { results: { data: [] }, continue_flag: 1, cursor: "x" } })).toEqual({ posts: [], hasMore: false, next: {} });
  });
  it("缺关键字段的条目被跳过，不抛错", () => {
    const bad = { data: { results: { data: [{ items: [{ title: "x" }, { hashDocID: "1", pubTime: 1, source: {} }] }] } } };
    expect(parseChannelsSearch(bad).posts).toEqual([]);
  });
});

describe("公众号：解析搜索结果（真实样本）", () => {
  const r = parseMpSearch(mpSearch);
  it("字段", () => {
    expect(r.posts.length).toBeGreaterThan(5);
    for (const p of r.posts) {
      expect(p.platform).toBe("wechat_mp");
      expect(p.postId).toMatch(/^.+_\d+_\d+$/); // biz_mid_idx
      expect(p.accountUid).toMatch(/^[A-Za-z0-9+/=]+$/); // __biz
      expect(p.postId.startsWith(`${p.accountUid}_`)).toBe(true);
      expect(p.url).toMatch(/^https:\/\/mp\.weixin\.qq\.com\/s\?__biz=.+&mid=\d+&idx=\d+(&sn=[0-9a-f]+)?$/);
      expect(p.url).not.toContain("chksm");
      expect(p.title).not.toContain("<em");
      expect(p.text).toBeTruthy(); // 摘要参与判定
      expect(p.accountName).toBeTruthy();
      expect(p.publishedAt).toBeGreaterThan(1e12);
      expect(p.followers).toBeNull();
      expect([p.likes, p.comments, p.plays]).toEqual([0, 0, 0]);
    }
  });
  it("摘要参与「是否投放内容」的判定：关键词只出现在摘要里也能命中", () => {
    const p = r.posts.find((x) => x.text && !x.title.includes(x.text.slice(2, 6)))!;
    const kw = p.text!.slice(2, 6);
    expect(classify({ ...p, text: "" }, { keywords: [kw], match: "any" })).toBeNull();
    expect(classify(p, { keywords: [kw], match: "any" })?.matchedKeywords).toEqual([kw]);
  });
  it("翻页", () => {
    expect(r.hasMore).toBe(true);
    expect(typeof r.next.cursor).toBe("string");
  });
});

/* ───────── 发请求：用桩 fetch 校验入参与错误处理 ───────── */
type Call = { url: string; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Call[] = [];
let responder: (c: Call) => Response = () => new Response("{}", { status: 404 });
beforeAll(() => {
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    const c = { url: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return responder(c);
  });
});
beforeEach(() => { calls = []; db().exec("DELETE FROM api_cache; DELETE FROM api_calls;"); });
afterEach(() => { delete process.env.WECHAT_CHANNELS_FANS; });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const empty400 = () => json({ detail: { code: 400, message: "Request failed. Please retry." } }, 400);

describe("请求参数", () => {
  it("视频号：POST、按最新排序、时间档位、不带 raw；第二页带上 cursor 且筛选条件不变", async () => {
    responder = () => json(chSearch);
    await searchWechatChannels("AI视频", 3, null, 1);
    await searchWechatChannels("AI视频", 3, { cursor: "CUR1" }, 1);
    expect(calls[0].url).toBe("/api/v1/wechat_search/v2/fetch_search_videos");
    expect(calls[0].body).toEqual({ keyword: "AI视频", sort: "latest", publish_time: "week" });
    expect(calls[1].body).toEqual({ keyword: "AI视频", sort: "latest", publish_time: "week", cursor: "CUR1" });
    expect(calls[0].body.raw).toBeUndefined(); // raw=false 实测不稳定
  });
  it("公众号：走综合搜索的 article 垂类", async () => {
    responder = () => json(mpSearch);
    const r = await searchWechatMp("AI视频", 30, null, 1);
    expect(calls[0].url).toBe("/api/v1/wechat_search/v2/fetch_search");
    expect(calls[0].body).toEqual({ keyword: "AI视频", business_type: "article", sort: "latest", publish_time: "half_year" });
    expect(r.posts.length).toBeGreaterThan(0);
  });
  it("关键词超过 100 字会被截断（接口上限）", async () => {
    responder = () => json(chSearch);
    await searchWechatChannels("字".repeat(150), 7, null, 1);
    expect(calls[0].body.keyword).toHaveLength(100);
  });
  it("结果为空时上游返回 400：当作没有结果，不让任务失败，也不重试", async () => {
    responder = empty400;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await searchWechatChannels("没有结果的词", 7, null, 1)).toEqual({ posts: [], hasMore: false, next: {} });
    expect(await searchWechatMp("没有结果的词", 7, null, 1)).toEqual({ posts: [], hasMore: false, next: {} });
    expect(calls).toHaveLength(2); // 各一次，没有重试
  });
  it("只有 400 被当成空结果；其他 4xx 照常抛出（不会静默吞掉）", async () => {
    // 不用 401：鉴权失败会让进程内共享的 TikHub 客户端永久熔断，影响后面的用例
    responder = () => json({}, 404);
    await expect(searchWechatChannels("x", 7, null, 1)).rejects.toThrow(/404/);
  });
});

describe("视频号：换账号与粉丝数", () => {
  const post = parseChannelsSearch(chSearch).posts[0];
  it("用 exportId 换出 finder username 作为稳定账号 ID", async () => {
    responder = () => json(detail);
    const r = await resolveChannelsAccount(post, 1);
    expect(r?.uid).toMatch(/^v2_.+@finder$/);
    expect(r?.name).toBeTruthy();
    expect(calls[0].url).toBe("/api/v1/wechat_channels/v2/fetch_video_detail");
    expect(calls[0].body).toMatchObject({ export_id: post.ref!.exportId, raw: false });
  });
  it("失败 / 响应里没有 username → null，不抛错；没有 exportId 时不发请求", async () => {
    responder = () => json({ code: 200, data: {} });
    expect(await resolveChannelsAccount(post, 1)).toBeNull();
    responder = empty400;
    expect(await resolveChannelsAccount({ ...post, ref: { exportId: "export/other" } }, 1)).toBeNull();
    calls = [];
    expect(await resolveChannelsAccount({ ...post, ref: undefined }, 1)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("粉丝数：接口返回 0 视为未知（实测有 1308 条作品的账号返回 0）；大于 0 才采信", async () => {
    const u = detail.data.username;
    responder = () => json(profile);
    expect(profile.data.fans_count).toBe(0); // 真实响应里是数字 0
    expect(await getChannelsFollowers(u, 1)).toBeNull();
    db().exec("DELETE FROM api_cache");
    responder = () => json({ data: { ...profile.data, fans_count: "12345" } });
    expect(await getChannelsFollowers(u, 1)).toBe(12345);
    expect(calls.at(-1)!.body).toEqual({ username: u, raw: false });
  });
  it("临时账号查不了粉丝；WECHAT_CHANNELS_FANS=off 时不发请求", async () => {
    responder = () => json(profile);
    expect(await getChannelsFollowers("av:abc", 1)).toBeNull();
    process.env.WECHAT_CHANNELS_FANS = "off";
    expect(await getChannelsFollowers(detail.data.username, 1)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("成本预估", () => {
  const base: TaskConfig = { platforms: [], keywords: ["a"], match: "any", time: { type: "relative", days: 7 }, repeatThreshold: 2, maxPages: 2, minConfidence: 0.5 };
  it("视频号每个账号 2 次（换账号 + 粉丝），关掉粉丝后 1 次；公众号 0 次；抖音不变", () => {
    const acc = Math.min(100, 1 * 2 * 12);
    expect(estimateCalls({ ...base, platforms: ["wechat_channels"] })).toBe(2 + 2 * acc);
    process.env.WECHAT_CHANNELS_FANS = "off";
    expect(estimateCalls({ ...base, platforms: ["wechat_channels"] })).toBe(2 + 1 * acc);
    expect(estimateCalls({ ...base, platforms: ["wechat_mp"] })).toBe(2);
    expect(estimateCalls({ ...base, platforms: ["douyin"] })).toBe(2);
    expect(estimateCalls({ ...base, platforms: ["bilibili"] })).toBe(2 + acc);
  });
});

/* ───────── 端到端：搜索 → 判定 → 换账号 → 入库 ───────── */
function newTask(config: object) {
  const r = db().prepare("INSERT INTO tasks(config, created_at, competitor_id, name, scope) VALUES (?,?,?,?,?)").run(JSON.stringify(config), Date.now(), null, "T", "");
  const id = Number(r.lastInsertRowid);
  db().prepare("UPDATE tasks SET scope=? WHERE id=?").run(`t${id}`, id);
  return id;
}
const cfgOf = (platform: string, kw: string, extra: object = {}) => ({ platforms: [platform], keywords: [kw], match: "any", time: { type: "relative", days: 3650 }, repeatThreshold: 2, maxPages: 1, minConfidence: 0.5, ...extra });


/** 取标题里第一段连续的 ≥4 个汉字作关键词（保证真的在标题里出现） */
const kwFrom = (posts: Array<{ title: string }>) => {
  for (const p of posts) { const m = /[一-鿿]{4,}/.exec(p.title); if (m) return m[0].slice(0, 4); }
  throw new Error("夹具里没有 4 个连续汉字的标题");
};

describe("端到端", () => {
  it("视频号：只对命中的账号换账号；换成功用 finder username，失败沿用临时 ID；互动过滤对本平台不生效", async () => {
    const parsed = parseChannelsSearch(chSearch).posts;
    const kw = kwFrom(parsed);
    const matched = parsed.filter((p) => classify(p, { keywords: [kw], match: "any" }));
    expect(matched.length).toBeGreaterThan(0);
    const distinct = new Set(matched.map((p) => p.accountUid)).size;

    let n = 0;
    responder = (c) => {
      if (c.url.endsWith("fetch_search_videos")) return json(chSearch);
      if (c.url.endsWith("fetch_video_detail")) return ++n === 1 ? json({ data: { ...detail.data, username: "v2_resolved@finder", nickname: "真实昵称" } }) : empty400(); // 第一个账号换成功，其余失败
      if (c.url.endsWith("fetch_user_profile")) return json({ data: { ...profile.data, fans_count: "50000" } });
      return json({}, 404);
    };
    const t = newTask(cfgOf("wechat_channels", kw, { engagement: { minLikes: 999999999 } }));
    await runTask(t);
    expect((db().prepare("SELECT status FROM tasks WHERE id=?").get(t) as { status: string }).status).toBe("done");

    expect(calls.filter((c) => c.url.endsWith("fetch_video_detail"))).toHaveLength(distinct); // 每个命中账号一次，而不是每条搜索结果一次
    const rows = accountRows({ taskId: t });
    expect(rows.length).toBe(distinct);
    const ok = rows.find((r) => r.uid === "v2_resolved@finder")!;
    expect(ok).toMatchObject({ name: "真实昵称", followers: 50000 });
    if (distinct > 1) expect(rows.some((r) => r.uid.startsWith("av:") || r.uid.startsWith("nick:"))).toBe(true);
    expect(rows.filter((r) => r.uid.startsWith("av:")).every((r) => r.followers === null)).toBe(true);
  });

  it("公众号：以 __biz 归集账号，不补任何资料；互动过滤不生效", async () => {
    const parsed = parseMpSearch(mpSearch).posts;
    const kw = kwFrom(parsed);
    const matched = parsed.filter((p) => classify(p, { keywords: [kw], match: "any" }));
    expect(matched.length).toBeGreaterThan(0);
    responder = (c) => (c.url.endsWith("/fetch_search") ? json(mpSearch) : json({}, 404));
    const t = newTask(cfgOf("wechat_mp", kw, { engagement: { minLikes: 100, minComments: 10 } }));
    await runTask(t);
    expect((db().prepare("SELECT status FROM tasks WHERE id=?").get(t) as { status: string }).status).toBe("done");
    expect(calls).toHaveLength(1); // 只有一次搜索，没有任何补资料调用
    const rows = accountRows({ taskId: t });
    expect(rows.length).toBe(new Set(matched.map((p) => p.accountUid)).size);
    expect(rows.every((r) => r.followers === null && r.tier === "unknown")).toBe(true);
    expect(rows[0].platform).toBe("wechat_mp");
  });

  it("搜索返回 400（无结果）：任务正常完成，命中 0 个账号", async () => {
    responder = empty400;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = newTask(cfgOf("wechat_channels", "没有结果的词"));
    await runTask(t);
    expect((db().prepare("SELECT status FROM tasks WHERE id=?").get(t) as { status: string }).status).toBe("done");
    expect(accountRows({ taskId: t })).toHaveLength(0);
  });
});
