import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gtm-q-")), "q.db");

import { db } from "../src/lib/db";
import {
  accountRows, compareCompetitors, compareTasks, flagPost, listAccounts, saveAccountMeta, saveCompetitor, weeklyTrend, accountDetail,
} from "../src/lib/queries";
import { toCsv } from "../src/lib/csv";
import { getSettings, saveSettings, tierOf } from "../src/lib/settings";

const NOW = Date.now();
const DAY = 86_400_000;

function task(id: number, competitorId: number | null) {
  db().prepare("INSERT INTO tasks(id, config, created_at, status, competitor_id, scope, name) VALUES (?,?,?,?,?,?,?)")
    .run(id, JSON.stringify({ repeatThreshold: 2 }), NOW, "done", competitorId, competitorId ? `c${competitorId}` : `t${id}`, `任务${id}`);
}
function post(taskId: number, scope: string, platform: string, uid: string, postId: string, ageDays = 3, likes = 10) {
  db().prepare("INSERT OR REPLACE INTO accounts(platform, uid, name, followers, updated_at) VALUES (?,?,?,?,?)").run(platform, uid, `名-${uid}`, uid === "big" ? 2_000_000 : 5000, NOW);
  db().prepare(
    `INSERT INTO promo_posts(platform, post_id, task_id, scope, account_uid, url, title, published_at, likes, comments, plays, keywords, confidence, reasons, crawled_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(platform, postId, taskId, scope, uid, "u", "t", NOW - ageDays * DAY, likes, 1, 0, '["k"]', 0.7, "[]", NOW);
}

beforeAll(() => {
  const A = saveCompetitor({ name: "竞品A", keywords: ["a"], platforms: ["douyin"] });
  const B = saveCompetitor({ name: "竞品B", keywords: ["b"], platforms: ["douyin"] });
  expect([A, B]).toEqual([1, 2]);
  task(1, 1); task(2, 1); task(3, 2);
  // 竞品A 任务1：x 投 1 次，y 投 1 次
  post(1, "c1", "douyin", "x", "p1"); post(1, "c1", "douyin", "y", "p2");
  // 竞品A 任务2（更新）：x 再投 p3，同时 p1 重复出现（跨任务重复抓到），z 新增，big 新增
  post(2, "c1", "douyin", "x", "p1"); post(2, "c1", "douyin", "x", "p3", 1); post(2, "c1", "douyin", "z", "p4"); post(2, "c1", "douyin", "big", "p5");
  // 竞品B：x 也被投、w 独占
  post(3, "c2", "douyin", "x", "p6"); post(3, "c2", "douyin", "w", "p7");
});

describe("账号聚合", () => {
  it("同一作品跨任务重复抓取只计一次（按 scope 去重）", () => {
    const x = accountRows({ competitorId: 1 }).find((a) => a.uid === "x")!;
    expect(x.promoCount).toBe(2); // p1 + p3，而不是 3
    expect(x.isRepeat).toBe(true);
    expect(x.label).toBe("2-3次复投");
  });
  it("任务视角是该次任务的快照", () => {
    expect(accountRows({ taskId: 1 }).map((a) => a.uid).sort()).toEqual(["x", "y"]);
    expect(accountRows({ taskId: 1 }).find((a) => a.uid === "x")!.promoCount).toBe(1);
  });
  it("全局视角：x 同时属于 A、B，maxRepeat 取单竞品最大值", () => {
    const x = accountRows({}).find((a) => a.uid === "x")!;
    expect(x.promoCount).toBe(3);
    expect(x.maxRepeat).toBe(2);
    expect(x.competitors.map((c) => c.name).sort()).toEqual(["竞品A", "竞品B"]);
  });
  it("层级、筛选、排序、分页", () => {
    expect(accountRows({}).find((a) => a.uid === "big")!.tier).toBe("head");
    expect(accountRows({ tier: "head" }).map((a) => a.uid)).toEqual(["big"]);
    expect(accountRows({ repeatOnly: true }).map((a) => a.uid)).toEqual(["x"]);
    expect(accountRows({ competitor: 2 }).map((a) => a.uid).sort()).toEqual(["w", "x"]);
    expect(accountRows({ sort: "followers", dir: "desc" })[0].uid).toBe("big");
    const l = listAccounts({ pageSize: 2, page: 2 });
    expect(l.rows).toHaveLength(2);
    expect(l.total).toBe(accountRows({}).length);
  });
});

describe("人工校正与运营标注", () => {
  it("否决作品后计数扣除，详情里仍可见并可恢复", () => {
    flagPost("douyin", "p3", "rejected");
    expect(accountRows({ competitorId: 1 }).find((a) => a.uid === "x")!.promoCount).toBe(1);
    expect(accountDetail("douyin", "x")!.posts.find((p) => p.postId === "p3")!.verdict).toBe("rejected");
    flagPost("douyin", "p3", "auto");
    expect(accountRows({ competitorId: 1 }).find((a) => a.uid === "x")!.promoCount).toBe(2);
  });
  it("状态/标签/备注", () => {
    saveAccountMeta("douyin", "y", { status: "contacted", tags: ["腰部", " 美妆 "], note: "已私信" });
    const y = accountRows({}).find((a) => a.uid === "y")!;
    expect([y.status, y.tags, y.note]).toEqual(["contacted", ["腰部", "美妆"], "已私信"]);
    expect(accountRows({ status: "contacted" })).toHaveLength(1);
    expect(() => saveAccountMeta("douyin", "y", { status: "bogus" })).toThrow();
  });
});

describe("对比", () => {
  it("任务1 → 任务2：新增 / 流失 / 持续 / 新晋复投", () => {
    const c = compareTasks(1, 2);
    expect(c.added.map((a) => a.uid).sort()).toEqual(["big", "z"]);
    expect(c.lost.map((a) => a.uid)).toEqual(["y"]);
    expect(c.kept.map((a) => a.uid)).toEqual(["x"]);
    expect(c.upgraded.map((a) => a.uid)).toEqual(["x"]);
  });
  it("竞品A vs B：共同 KOL 与独占数", () => {
    const c = compareCompetitors([1, 2]);
    expect(c.shared.map((a) => a.uid)).toEqual(["x"]);
    expect(c.shared[0].counts).toEqual({ 1: 2, 2: 1 });
    expect(c.competitors.find((k) => k.id === 2)!.exclusive).toBe(1);
    expect(c.matrix[0][1].inter).toBe(1);
    expect(() => compareCompetitors([1])).toThrow();
  });
});

describe("趋势", () => {
  it("按周聚合，序列长度固定", () => {
    const t = weeklyTrend({ competitorId: 1 }, 12);
    expect(t.weeks).toHaveLength(12);
    expect(t.series.c1.reduce((a, b) => a + b, 0)).toBe(5); // p1–p5 去重后共 5 条
  });
});

describe("设置", () => {
  it("默认值、保存校验、分层", () => {
    expect(getSettings().repeatThreshold).toBe(2);
    expect(() => saveSettings({ tiers: { head: 10, waist: 100, tail: 1 } })).toThrow("头部 > 腰部 > 尾部");
    const s = saveSettings({ repeatThreshold: 3 });
    expect(getSettings().repeatThreshold).toBe(3);
    saveSettings({ repeatThreshold: 2 });
    expect(tierOf(150_000, s.tiers)).toBe("waist");
    expect(tierOf(null, s.tiers)).toBe("unknown");
  });
});

describe("CSV", () => {
  it("BOM、转义、公式注入防护", () => {
    const out = toCsv([["a", (r: { v: string }) => r.v]], [{ v: 'x,"y"' }, { v: "=SUM(A1)" }, { v: "-5" }]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain('"x,""y"""');
    expect(out).toContain("'=SUM(A1)");
    expect(out).toContain("\r\n-5"); // 纯数字不加前缀
  });
});

describe("总览", () => {
  it("竞品的 platforms 是数组，摘要平台分布为 platformCounts", async () => {
    const { overview } = await import("../src/lib/queries");
    const c = overview().perCompetitor[0];
    expect(Array.isArray(c.platforms)).toBe(true);
    expect(typeof c.platformCounts).toBe("object");
  });
});
