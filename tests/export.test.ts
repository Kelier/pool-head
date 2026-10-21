import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gtm-x-")), "x.db");

import ExcelJS from "exceljs";
import { db } from "../src/lib/db";
import { saveCompetitor } from "../src/lib/queries";
import { buildSheets, cellText, contentDisposition, guard, renderCsv, renderJson, renderXlsx } from "../src/lib/export";
import { GET } from "../src/app/api/export/route";

const NOW = Date.now();
const DAY = 86_400_000;

function task(id: number, competitorId: number) {
  db().prepare("INSERT INTO tasks(id, config, created_at, status, competitor_id, scope, name) VALUES (?,?,?,?,?,?,?)")
    .run(id, JSON.stringify({ repeatThreshold: 2 }), NOW, "done", competitorId, `c${competitorId}`, `任务${id}`);
}
function post(taskId: number, scope: string, uid: string, postId: string, name = `名-${uid}`) {
  db().prepare("INSERT OR REPLACE INTO accounts(platform, uid, name, profile_url, followers, updated_at) VALUES (?,?,?,?,?,?)")
    .run("douyin", uid, name, `https://example.com/${uid}`, 5000, NOW);
  db().prepare(
    `INSERT INTO promo_posts(platform, post_id, task_id, scope, account_uid, url, title, published_at, likes, comments, plays, keywords, confidence, reasons, crawled_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run("douyin", postId, taskId, scope, uid, `https://example.com/p/${postId}`, `标题-${postId}`, NOW - 3 * DAY, 10, 1, 0, '["k"]', 0.7, '["命中关键词"]', NOW);
}

const sp = (o: Record<string, string>) => new URLSearchParams(o);
const call = (qs: string) => GET(new Request(`http://localhost:3000/api/export?${qs}`));

beforeAll(() => {
  saveCompetitor({ name: "竞品A", keywords: ["a"], platforms: ["douyin"] });
  saveCompetitor({ name: "竞品B", keywords: ["b"], platforms: ["douyin"] });
  task(1, 1); task(2, 1); task(3, 2);
  post(1, "c1", "x", "p1"); post(1, "c1", "y", "p2");
  post(2, "c1", "x", "p1"); post(2, "c1", "x", "p3"); post(2, "c1", "z", "p4", "=SUM(A1)");
  post(3, "c2", "x", "p6"); post(3, "c2", "w", "p7");
});

describe("buildSheets", () => {
  it("accounts：1 张表，表头沿用中文列名，行数与账号数一致", () => {
    const b = buildSheets("accounts", sp({}));
    expect(b.sheets).toHaveLength(1);
    expect(b.sheets[0].columns.map((c) => c.header)).toEqual(expect.arrayContaining(["账号", "平台", "粉丝数", "投放总次数", "高频复投", "涉及竞品"]));
    expect(b.sheets[0].rows).toHaveLength(4); // x y z w
  });
  it("accounts 筛选参数与 /api/accounts 一致，抬头带筛选摘要", () => {
    const b = buildSheets("accounts", sp({ repeat: "1", competitorScope: "1" }));
    expect(b.sheets[0].rows.map((a: { uid: string }) => a.uid)).toEqual(["x"]);
    expect(b.filters.join("|")).toContain("竞品A");
    expect(b.filters).toContain("仅高频复投");
  });
  it("posts：按 scope 去重（p1 跨任务只算一次），只含筛选命中的账号", () => {
    const rows = buildSheets("posts", sp({ competitorScope: "1" })).sheets[0].rows;
    expect(rows.map((r: { title: string }) => r.title).sort()).toEqual(["标题-p1", "标题-p2", "标题-p3", "标题-p4"]);
    expect(buildSheets("posts", sp({})).sheets[0].columns.map((c) => c.header)).toEqual(expect.arrayContaining(["作品标题", "作品链接", "发布时间", "置信度"]));
  });
  it("compare-tasks：全部变化 + 新增/流失/持续/新晋复投", () => {
    const b = buildSheets("compare-tasks", sp({ a: "1", b: "2" }));
    expect(b.sheets.map((s) => s.name)).toEqual(["全部变化", "新增", "流失", "持续", "新晋复投"]);
    expect(b.sheets[0].columns[0].header).toBe("变化");
    expect(b.sheets[1].rows).toHaveLength(1); // z
    expect(b.sheets[2].rows).toHaveLength(1); // y
    expect(b.sheets[4].rows).toHaveLength(1); // x 新晋复投
    expect(b.sheets[0].rows).toHaveLength(3);
  });
  it("compare-competitors：共同 KOL + 竞品摘要", () => {
    const b = buildSheets("compare-competitors", sp({ ids: "1,2" }));
    expect(b.sheets.map((s) => s.name)).toEqual(["共同KOL", "竞品摘要"]);
    expect(b.sheets[0].rows).toHaveLength(1);
    expect(b.sheets[0].columns.map((c) => c.header)).toEqual(expect.arrayContaining(["竞品A 投放次数", "竞品B 投放次数", "合计"]));
    expect(b.sheets[1].rows).toHaveLength(2);
  });
  it("report：概览/复投Top/近7天新增/作品明细", () => {
    const b = buildSheets("report", sp({ id: "1" }));
    expect(b.sheets.map((s) => s.name)).toEqual(["概览指标", "高频复投Top", "近7天新增", "作品明细"]);
    expect(b.title).toContain("竞品A");
    expect(b.sheets[0].rows.find((r: { k: string }) => r.k === "投放账号数")?.v).toBe(3);
  });
  it("非法参数抛错", () => {
    expect(() => buildSheets("compare-tasks", sp({}))).toThrow("缺少对比的任务参数");
    expect(() => buildSheets("compare-competitors", sp({ ids: "1" }))).toThrow("至少选择两个竞品");
    expect(() => buildSheets("report", sp({ id: "999" }))).toThrow("竞品不存在");
  });
});

describe("渲染器", () => {
  it("CSV：带 BOM，多 sheet 只导出第一张，日期为人类可读文本", () => {
    const csv = renderCsv(buildSheets("compare-tasks", sp({ a: "1", b: "2" })));
    expect(csv.startsWith("﻿变化,账号")).toBe(true);
    expect(csv).toContain("新增,");
    expect(csv).not.toContain("新晋复投,账号"); // 其余 sheet 不在 CSV 里
  });
  it("JSON：按 sheet 分组，日期为 ISO", () => {
    const j = JSON.parse(renderJson(buildSheets("accounts", sp({}))));
    expect(Object.keys(j.sheets)).toEqual(["账号列表"]);
    expect(j.sheets["账号列表"]).toHaveLength(4);
    expect(j.sheets["账号列表"][0]["最近投放"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("XLSX：能被读回；表头冻结+筛选；日期是真日期；链接是超链接；公式注入被防护", async () => {
    const buf = await renderXlsx(buildSheets("accounts", sp({})));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("账号列表")!;
    expect(ws.rowCount).toBe(5); // 表头 + 4 行
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers[0]).toBe("账号");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    const col = (h: string) => headers.indexOf(h) + 1;
    const rows = Array.from({ length: 4 }, (_, i) => ws.getRow(i + 2));
    // 公式注入：名称 =SUM(A1) 被加 ' 前缀，且不是公式单元格
    const names = rows.map((r) => r.getCell(1).value);
    expect(names).toContain("'=SUM(A1)");
    expect(rows.every((r) => typeof r.getCell(1).value === "string")).toBe(true);
    // 日期 / 数字 / 超链接
    expect(rows[0].getCell(col("最近投放")).value).toBeInstanceOf(Date);
    expect(typeof rows[0].getCell(col("粉丝数")).value).toBe("number");
    const link = rows[0].getCell(col("主页链接")).value as { hyperlink?: string };
    expect(link.hyperlink).toMatch(/^https:\/\/example\.com\//);
    // 列宽在 8–50
    for (let i = 1; i <= headers.length; i++) {
      const w = ws.getColumn(i).width ?? 0;
      expect(w).toBeGreaterThanOrEqual(8);
      expect(w).toBeLessThanOrEqual(50);
    }
  });
  it("XLSX 多 sheet：sheet 数与名称", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderXlsx(buildSheets("compare-tasks", sp({ a: "1", b: "2" })))) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["全部变化", "新增", "流失", "持续", "新晋复投"]);
  });
  it("工具函数", () => {
    expect(guard("=1+1")).toBe("'=1+1");
    expect(guard("-5")).toBe("-5");
    expect(guard("普通")).toBe("普通");
    expect(cellText({ header: "t", fmt: "date", get: () => 0 }, {})).toBe("");
    const cd = contentDisposition('投放"账号".xlsx');
    expect(cd).toContain("filename*=UTF-8''" + encodeURIComponent('投放"账号".xlsx'));
    expect(cd.split("filename*")[0]).not.toMatch(/[^\x20-\x7e]/);
  });
});

describe("GET /api/export", () => {
  it("非法 type / format → 400 JSON", async () => {
    for (const qs of ["type=hack", "type=accounts&format=exe", "type=../../etc/passwd", "type=accounts&format=pdf%20--x"]) {
      const r = await call(qs);
      expect(r.status).toBe(400);
      expect(typeof (await r.json()).error).toBe("string");
    }
  });
  it("参数不合法 → 400（含 PDF 路径，不会去启动 Chrome）", async () => {
    expect((await call("type=report&format=xlsx&id=999")).status).toBe(400);
    expect((await call("type=report&format=pdf&id=999")).status).toBe(400);
    expect((await call("type=compare-tasks&format=csv")).status).toBe(400);
  });
  it("csv / json / xlsx 的响应头与内容", async () => {
    const csv = await call("type=accounts&format=csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    const bytes = Buffer.from(await csv.arrayBuffer()); // Response.text() 会吞掉 BOM，所以验字节
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const json = await call("type=accounts&format=json");
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(await json.text()).sheets).toBeTruthy();
    const x = await call("type=report&format=xlsx&id=1");
    expect(x.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(x.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString()).toBe("PK"); // zip
  });
  it("找不到 Chrome → 501，并给出预览地址", async () => {
    const old = process.env.CHROME_PATH;
    process.env.CHROME_PATH = "/nonexistent/chrome";
    try {
      const r = await call("type=accounts&format=pdf&repeat=1");
      expect(r.status).toBe(501);
      const j = await r.json();
      expect(j.error).toContain("CHROME_PATH");
      expect(j.previewUrl).toBe("http://localhost:3000/print/accounts?repeat=1");
    } finally {
      if (old === undefined) delete process.env.CHROME_PATH;
      else process.env.CHROME_PATH = old;
    }
  });
});
