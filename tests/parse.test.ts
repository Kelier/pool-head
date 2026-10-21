import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseDouyinSearch, douyinPublishBucket } from "../src/lib/platforms/douyin";
import { parseXhsSearch, xhsTimeFilter } from "../src/lib/platforms/xiaohongshu";
import { classify, frequencyLabel } from "../src/lib/classify";
import { resolveRange } from "../src/lib/pipeline";
import type { NormPost } from "../src/lib/types";

const load = (f: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${f}`, "utf8"));

describe("解析真实响应样本", () => {
  it("抖音", () => {
    const r = parseDouyinSearch(load("douyin_search.json"));
    expect(r.posts.length).toBeGreaterThan(0);
    const p = r.posts[0];
    expect(p.accountUid).toMatch(/^MS4w/);
    expect(p.url).toContain("douyin.com/video/");
    expect(p.publishedAt).toBeGreaterThan(1e12);
    expect(typeof p.followers).toBe("number");
    expect(r.hasMore).toBe(true);
    expect(r.next).toHaveProperty("cursor");
  });
  it("小红书", () => {
    const r = parseXhsSearch(load("xhs_search.json"));
    expect(r.posts.length).toBeGreaterThan(0);
    expect(r.posts[0].accountUid).toBeTruthy();
    expect(r.posts[0].followers).toBeNull();
    expect(r.hasMore).toBe(true);
    expect(r.next).toHaveProperty("search_id");
  });
});

describe("判定", () => {
  const base: NormPost = { platform: "douyin", postId: "1", url: "", hashtags: [], publishedAt: 0, likes: 0, comments: 0, plays: 0, accountUid: "u", accountName: "n", accountUrl: "", followers: 1, title: "" };
  it("any / all", () => {
    const post = { ...base, title: "LibTV 导演台 体验" };
    expect(classify(post, { keywords: ["libtv", "别的"], match: "any" })).not.toBeNull();
    expect(classify(post, { keywords: ["libtv", "别的"], match: "all" })).toBeNull();
  });
  it("关键词分词：libtv导演台 命中 'LibTV 打通…3D 导演台'", () => {
    const post = { ...base, title: "LibTV 打通角色库、故事板和 3D 导演台" };
    expect(classify(post, { keywords: ["libtv导演台"], match: "any" })).not.toBeNull();
    expect(classify({ ...base, title: "只有 libtv" }, { keywords: ["libtv导演台"], match: "any" })).toBeNull();
  });
  it("推广标识提高置信度", () => {
    const a = classify({ ...base, title: "libtv 好用" }, { keywords: ["libtv"], match: "any" })!;
    const b = classify({ ...base, title: "libtv 品牌合作 评论区领取" }, { keywords: ["libtv"], match: "any" })!;
    expect(b.confidence).toBeGreaterThan(a.confidence);
  });
  it("频次标签", () => {
    expect([1, 2, 3, 4].map(frequencyLabel)).toEqual(["单次试投", "2-3次复投", "2-3次复投", "深度绑定"]);
  });
});

describe("时间", () => {
  it("档位映射", () => {
    expect([1, 5, 30, 400].map(douyinPublishBucket)).toEqual(["1", "7", "180", "0"]);
    expect([1, 5, 30, 400].map(xhsTimeFilter)).toEqual(["一天内", "一周内", "半年内", "不限"]);
  });
  it("绝对区间含首尾", () => {
    const r = resolveRange({ type: "absolute", from: "2026-10-01", to: "2026-10-15" }, new Date("2026-10-14T12:00:00").getTime());
    expect(r.days).toBe(14);
    expect(r.to - r.from).toBeGreaterThan(14 * 86_400_000);
  });
});
