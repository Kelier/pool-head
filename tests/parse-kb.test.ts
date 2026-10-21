import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseKuaishouSearch, kuaishouTimeFilter } from "../src/lib/platforms/kuaishou";
import { parseBilibiliSearch, bilibiliTimeRange } from "../src/lib/platforms/bilibili";

const load = (f: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${f}`, "utf8"));

describe("快手", () => {
  const r = parseKuaishouSearch(load("kuaishou_search.json"));
  it("解析字段", () => {
    expect(r.posts.length).toBeGreaterThan(0);
    for (const p of r.posts) {
      expect(p.platform).toBe("kuaishou");
      expect(p.url).toBe(`https://www.kuaishou.com/short-video/${p.postId}`);
      expect(p.postId).toMatch(/^3x[a-z0-9]+$/);
      expect(p.accountUid).toMatch(/^\d+$/);
      expect(p.accountName).toBeTruthy();
      expect(p.accountUrl).toContain("kuaishou.com/profile/");
      expect(p.publishedAt).toBeGreaterThan(1e12);
      expect(p.publishedAt).toBeLessThan(1e14);
      expect(p.followers).toBeNull();
      expect(p.likes).toBeGreaterThanOrEqual(0);
    }
  });
  it("翻页", () => {
    expect(r.hasMore).toBe(true);
    expect(r.next).toEqual({ pcursor: "1" });
    expect(parseKuaishouSearch({ data: { mixFeeds: [], pcursor: "no_more" } }).hasMore).toBe(false);
  });
  it("时间档位", () => {
    expect([1, 5, 30, 90].map(kuaishouTimeFilter)).toEqual(["one_day", "one_week", "one_month", "all"]);
  });
});

describe("B站", () => {
  const r = parseBilibiliSearch(load("bilibili_search.json"));
  it("解析字段并去高亮标签", () => {
    expect(r.posts.length).toBeGreaterThan(0);
    for (const p of r.posts) {
      expect(p.platform).toBe("bilibili");
      expect(p.url).toMatch(/^https:\/\/www\.bilibili\.com\/video\/BV\w+$/);
      expect(p.accountUrl).toBe(`https://space.bilibili.com/${p.accountUid}`);
      expect(p.title).toBeTruthy();
      expect(p.title).not.toMatch(/<[^>]+>/);
      expect(p.publishedAt).toBeGreaterThan(1e12);
      expect(p.followers).toBeNull();
    }
    expect(r.posts[0].title).toContain("LibTV导演台");
  });
  it("翻页", () => {
    expect(r.hasMore).toBe(true);
    expect(r.next).toEqual({ page: 2 });
    expect(parseBilibiliSearch({ data: { data: { page: 2, numPages: 2, result: [] } } }).hasMore).toBe(false);
  });
  it("时间区间", () => {
    expect(bilibiliTimeRange(7, 1_000_000_000_000)).toEqual({ begin: 1_000_000_000 - 7 * 86400, end: 1_000_000_000 });
  });
});
