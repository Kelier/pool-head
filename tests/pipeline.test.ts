import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gtm-p-")), "p.db");
process.env.TIKHUB_API_KEY = "test-key";
process.env.TIKHUB_GLOBAL_QPS = "8";

import { db } from "../src/lib/db";
import { runTask, createTask } from "../src/lib/pipeline";
import { saveCompetitor, accountRows, getTask } from "../src/lib/queries";
import { listAlerts } from "../src/lib/alerts";

const dy = readFileSync("tests/fixtures/douyin_search.json", "utf8");
let calls = 0;

beforeAll(() => {
  // 抖音搜索永远返回同一份真实样本；其余请求一律 404（不应被调用）
  vi.stubGlobal("fetch", async (url: URL) => {
    calls++;
    if (String(url).includes("fetch_video_search_v2")) return new Response(dy, { status: 200 });
    return new Response("{}", { status: 404 });
  });
});

const cfg = { platforms: ["douyin"], keywords: ["libtv"], match: "any", time: { type: "relative", days: 365 }, repeatThreshold: 2, maxPages: 1, minConfidence: 0.5 };

function newTask(competitorId: number | null, config = cfg) {
  const r = db().prepare("INSERT INTO tasks(config, created_at, competitor_id, name, scope) VALUES (?,?,?,?,?)").run(JSON.stringify(config), Date.now(), competitorId, "T", "");
  const id = Number(r.lastInsertRowid);
  db().prepare("UPDATE tasks SET scope=? WHERE id=?").run(competitorId ? `c${competitorId}` : `t${id}`, id);
  return id;
}

describe("runTask", () => {
  it("抓取→判定→按竞品 scope 入库；第二次运行不重复计数，新增账号为 0", async () => {
    const c = saveCompetitor({ name: "LibTV", keywords: ["libtv"], platforms: ["douyin"] });
    const t1 = newTask(c);
    await runTask(t1);
    const a = getTask(t1)!;
    expect(a.status).toBe("done");
    expect(a.progress.accounts).toBeGreaterThan(0);
    expect(a.progress.newAccounts).toBe(a.progress.accounts); // 首次：全部是新增
    const afterFirst = accountRows({ competitorId: c });

    const t2 = newTask(c);
    await runTask(t2);
    const b = getTask(t2)!;
    expect(b.progress.newAccounts).toBe(0);
    // 同一批作品被两个任务抓到，聚合后不翻倍
    expect(accountRows({ competitorId: c }).map((x) => x.promoCount)).toEqual(afterFirst.map((x) => x.promoCount));
    // 任务视角仍各自有快照
    expect(accountRows({ taskId: t1 }).length).toBe(accountRows({ taskId: t2 }).length);
    expect(listAlerts().items.some((x: any) => x.type === "task_done")).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("请求被缓存：第二个任务相同搜索不再出站", async () => {
    // 前一个用例里两次任务只应产生 1 次真实搜索（1h 缓存）
    expect(calls).toBe(1);
  });

  it("取消：标记 cancel 后任务以 cancelled 结束，且不发请求", async () => {
    const before = calls;
    const id = newTask(null, { ...cfg, keywords: ["别的词"] });
    db().prepare("UPDATE tasks SET cancel = 1 WHERE id = ?").run(id);
    await runTask(id);
    expect(getTask(id)!.status).toBe("cancelled");
    expect(calls).toBe(before);
  });

  it("命中排除词的内容被丢弃", async () => {
    const { saveSettings } = await import("../src/lib/settings");
    saveSettings({ rules: { promo: [], exclude: ["libtv"] } });
    const id = newTask(null, { ...cfg, keywords: ["libtv"] });
    await runTask(id);
    expect(getTask(id)!.progress.postsMatched).toBe(0);
    saveSettings({ rules: { promo: [], exclude: [] } });
  });

  it("createTask 公共入口会写 scope 并后台执行", async () => {
    const id = createTask(cfg as never, { name: "adhoc" });
    expect(getTask(id)!.scope).toBe(`t${id}`);
    await new Promise((r) => setTimeout(r, 800));
    expect(["done", "running"]).toContain(getTask(id)!.status);
  });
});
