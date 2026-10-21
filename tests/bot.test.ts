import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "gtm-bot-")), "b.db");
process.env.FEISHU_ADMIN_OPEN_IDS = "ou_admin";
process.env.FEISHU_ALLOWED_USERS = "ou_member";
process.env.FEISHU_ALLOWED_CHATS = "oc_team";
process.env.FEISHU_VERIFICATION_TOKEN = "tok123";
process.env.FEISHU_ENCRYPT_KEY = "enc-key";
process.env.APP_PUBLIC_URL = "https://mon.example.com";
process.env.TIKHUB_API_KEY = "test-key"; // 「用量」指令会读取调用预算配置

import { db } from "../src/lib/db";
import { saveCompetitor } from "../src/lib/queries";
import { addAlert } from "../src/lib/alerts";
import { parseCommand, parseDays, findCompetitor, dispatch } from "../src/lib/bot/commands";
import { handleMessageEvent, __resetBotState, type MessageEvent } from "../src/lib/bot/events";
import { roleOf, RateLimiter } from "../src/lib/bot/auth";
import { card } from "../src/lib/bot/cards";
import { encryptFeishu, decryptFeishu } from "../src/lib/bot/crypto";
import { watchTask, pushAlertsOnce } from "../src/lib/bot/watch";
import { FeishuClient } from "../src/lib/bot/feishu";
import type { BotBackend, BotCtx, Sender } from "../src/lib/bot/types";

const NOW = Date.now(), DAY = 86_400_000;
const sent: Array<{ kind: string; chat: string; payload: any; replyTo?: string }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
const sender: Sender = {
  text: async (chat, payload, replyTo) => void sent.push({ kind: "text", chat, payload, replyTo }),
  card: async (chat, payload, replyTo) => void sent.push({ kind: "card", chat, payload, replyTo }),
  file: async (chat, name, data, replyTo) => void sent.push({ kind: "file", chat, payload: { name, data }, replyTo }),
};
const runs: Array<{ id: number; days: number }> = [];
const backend: BotBackend = { runCompetitor: async (id, days) => (runs.push({ id, days }), { id: 99, estimate: 12 }) };

function post(taskId: number, scope: string, uid: string, postId: string, age = 3) {
  db().prepare("INSERT OR REPLACE INTO accounts(platform, uid, name, followers, updated_at) VALUES (?,?,?,?,?)").run("douyin", uid, `名-${uid}`, 50_000, NOW);
  db().prepare(`INSERT INTO promo_posts(platform, post_id, task_id, scope, account_uid, url, title, published_at, likes, comments, plays, keywords, confidence, reasons, crawled_at)
    VALUES ('douyin',?,?,?,?,'u','t',?,10,1,0,'["k"]',0.7,'[]',?)`).run(postId, taskId, scope, uid, NOW - age * DAY, NOW);
}

beforeAll(() => {
  const a = saveCompetitor({ name: "LibTV", keywords: ["libtv"], platforms: ["douyin"] });
  const b = saveCompetitor({ name: "LibVideo", keywords: ["x"], platforms: ["douyin"] });
  const c = saveCompetitor({ name: "即梦AI", keywords: ["即梦"], platforms: ["douyin"] });
  db().prepare("INSERT INTO tasks(id, config, created_at, status, competitor_id, scope, name, progress) VALUES (1,?,?,?,?,?,?,?)")
    .run(JSON.stringify({ repeatThreshold: 2 }), NOW, "done", a, `c${a}`, "LibTV", JSON.stringify({ accounts: 2, newAccounts: 2, repeatAccounts: 1, calls: 3 }));
  post(1, `c${a}`, "x", "p1"); post(1, `c${a}`, "x", "p2"); post(1, `c${a}`, "y", "p3");
  post(1, `c${c}`, "x", "p4");
  void b;
});
beforeEach(() => { sent.length = 0; runs.length = 0; __resetBotState(); });

const ctx = (role: BotCtx["role"] = "member"): BotCtx => ({ userId: "u", chatId: "oc_1", chatType: "p2p", role, baseUrl: "https://mon.example.com", sender, backend });
const msg = (text: string, o: Partial<NonNullable<MessageEvent["message"]>> = {}, user = "ou_admin"): MessageEvent => ({
  sender: { sender_id: { open_id: user }, sender_type: "user" },
  message: { message_id: `m_${Math.random()}`, chat_id: "oc_1", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text }), ...o },
});
const deps = () => ({ sender, backend, env: process.env as Record<string, string | undefined>, botOpenId: async () => "ou_bot" });

describe("解析", () => {
  it("去掉 @ 占位符，切词，别名大小写不敏感", () => {
    expect(parseCommand("@_user_1  复投   LibTV ")).toEqual({ name: "复投", args: ["LibTV"] });
    expect(parseCommand("/HELP")).toEqual({ name: "help", args: [] });
    expect(parseCommand("   ")).toBeNull();
  });
  it("天数写法", () => {
    expect(["近30天", "7天", "90", "一周", "半年", "abc", undefined].map((x) => parseDays(x))).toEqual([30, 7, 90, 7, 180, null, null]);
    expect(parseDays("999天")).toBe(365);
  });
  it("竞品模糊匹配：精确优先、歧义/不存在给出提示", () => {
    expect((findCompetitor("libtv") as any).c.name).toBe("LibTV"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((findCompetitor("即梦") as any).c.name).toBe("即梦AI"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((findCompetitor("lib") as any).error).toContain("匹配到多个"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((findCompetitor("不存在") as any).error).toContain("现有竞品"); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe("指令", () => {
  it("帮助：成员看不到「抓取」，管理员能看到", async () => {
    const m = JSON.stringify((await dispatch("帮助", ctx("member"))).card);
    const a = JSON.stringify((await dispatch("帮助", ctx("admin"))).card);
    expect(m).not.toContain("抓取 竞品名");
    expect(a).toContain("抓取 竞品名");
  });
  it("总览 / 竞品 / 复投 / 新增 / 账号 / 对比 / 任务 / 用量 / 提醒 都返回卡片", async () => {
    for (const t of ["总览", "竞品", "竞品 LibTV", "复投", "复投 LibTV", "新增", "账号 x", "对比 LibTV 即梦AI", "任务", "任务 1", "用量", "提醒"]) {
      const r = await dispatch(t, ctx());
      expect(r.card || r.text, t).toBeTruthy();
      if (r.card) { expect((r.card as any).header.title.content, t).toBeTruthy(); expect(JSON.stringify(r.card).length, t).toBeLessThan(30_000); } // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  });
  it("复投内容正确：x 在 LibTV 投放 2 次", async () => {
    const r = await dispatch("复投 LibTV", ctx());
    expect(JSON.stringify(r.card)).toContain("名-x");
    expect(JSON.stringify(r.card)).not.toContain("名-y"); // y 只有 1 次
  });
  it("对比：共同账号 x", async () => {
    expect(JSON.stringify((await dispatch("对比 LibTV 即梦AI", ctx())).card)).toContain("名-x");
  });
  it("导出 → xlsx 文件（zip 魔数 PK）", async () => {
    const r = await dispatch("导出 账号 LibTV", ctx());
    expect(r.file!.name).toMatch(/\.xlsx$/);
    expect(r.file!.data.subarray(0, 2).toString()).toBe("PK");
    expect((await dispatch("导出 报告 LibTV", ctx())).file).toBeTruthy();
    expect((await dispatch("导出 什么", ctx())).text).toContain("用法");
  });
  it("抓取：仅管理员；解析天数；调用 backend", async () => {
    expect((await dispatch("抓取 LibTV", ctx("member"))).text).toContain("仅管理员");
    expect(runs).toHaveLength(0);
    const r = await dispatch("抓取 LibTV 近7天", ctx("admin"));
    expect(runs).toEqual([{ id: 1, days: 7 }]);
    expect(r.text).toContain("任务 #99");
  });
  it("未知指令与意图解析钩子", async () => {
    expect((await dispatch("你好呀", ctx())).text).toContain("没听懂");
    const r = await dispatch("最近有啥新账号", ctx(), async () => ({ name: "新增", args: [] }));
    expect(r.card || r.text).toBeTruthy();
  });
  it("订阅/退订写库（管理员）", async () => {
    await dispatch("订阅", ctx("admin"));
    expect(db().prepare("SELECT COUNT(*) c FROM bot_subs WHERE chat_id='oc_1'").get()).toMatchObject({ c: 1 });
    await dispatch("退订", ctx("admin"));
    expect(db().prepare("SELECT COUNT(*) c FROM bot_subs").get()).toMatchObject({ c: 0 });
  });
});

describe("事件处理与权限", () => {
  it("默认拒绝：未授权用户收到自己的 open_id 指引，且不会执行指令", async () => {
    await handleMessageEvent(msg("总览", {}, "ou_stranger"), deps());
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toContain("ou_stranger");
    expect(sent[0].payload).toContain("FEISHU_ALLOWED_USERS");
  });
  it("成员可查询、不可抓取；管理员可抓取", async () => {
    await handleMessageEvent(msg("总览", {}, "ou_member"), deps());
    expect(sent[0].kind).toBe("card");
    sent.length = 0;
    await handleMessageEvent(msg("抓取 LibTV", {}, "ou_member"), deps());
    expect(sent[0].payload).toContain("仅管理员");
    expect(runs).toHaveLength(0);
    sent.length = 0;
    await handleMessageEvent(msg("抓取 LibTV", {}, "ou_admin"), deps());
    expect(runs).toHaveLength(1);
  });
  it("群聊：未 @ 机器人不响应；@ 了才响应；@ 别人不响应", async () => {
    const g = { chat_type: "group" as const, chat_id: "oc_team" };
    await handleMessageEvent(msg("总览", g, "ou_member"), deps());
    expect(sent).toHaveLength(0);
    await handleMessageEvent(msg("@_user_1 总览", { ...g, mentions: [{ key: "@_user_1", id: { open_id: "ou_other" } }] }, "ou_member"), deps());
    expect(sent).toHaveLength(0);
    await handleMessageEvent(msg("@_user_1 总览", { ...g, mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }] }, "ou_member"), deps());
    expect(sent).toHaveLength(1);
    expect(sent[0].replyTo).toBeTruthy(); // 群里用"回复"保持上下文
  });
  it("允许的群里，群成员即使不在用户名单也算成员", () => {
    expect(roleOf("ou_anyone", "oc_team")).toBe("member");
    expect(roleOf("ou_anyone", "oc_other")).toBe("none");
    expect(roleOf("ou_admin", "oc_other")).toBe("admin");
  });
  it("事件去重（飞书会重试）", async () => {
    const e = msg("总览");
    await handleMessageEvent(e, deps());
    await handleMessageEvent(e, deps());
    expect(sent).toHaveLength(1);
  });
  it("机器人自己发的消息、非文本消息", async () => {
    const e = msg("总览"); e.sender!.sender_type = "app";
    await handleMessageEvent(e, deps());
    expect(sent).toHaveLength(0);
    await handleMessageEvent(msg("x", { message_type: "image" }), deps());
    expect(sent[0].payload).toContain("只支持文字");
  });
  it("限流：每人每分钟 20 条", async () => {
    for (let i = 0; i < 22; i++) await handleMessageEvent(msg("帮助"), deps());
    expect(sent.filter((s) => s.kind === "text" && String(s.payload).includes("太频繁")).length).toBe(2);
  });
  it("指令异常不会炸，回复可读错误", async () => {
    const bad: BotBackend = { runCompetitor: async () => { throw new Error("超出预算"); } };
    await handleMessageEvent(msg("抓取 LibTV"), { ...deps(), backend: bad });
    expect(sent[0].payload).toContain("出错了：超出预算");
  });
});

describe("基础件", () => {
  it("RateLimiter 滑动窗口", () => {
    let t = 0;
    const r = new RateLimiter(2, 1000, () => t);
    expect([r.allow("a"), r.allow("a"), r.allow("a")]).toEqual([true, true, false]);
    t = 1500;
    expect(r.allow("a")).toBe(true);
    expect(r.allow("b")).toBe(true);
  });
  it("卡片结构：markdown 元素、按钮、note", () => {
    const c = card("T", "blue", ["a", ""], { note: "n", links: [{ text: "打开", url: "https://x" }] }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(c.header.template).toBe("blue");
    expect(c.elements.map((e: any) => e.tag)).toEqual(["markdown", "hr", "action", "note"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(c.elements[2].actions[0]).toMatchObject({ tag: "button", url: "https://x", type: "primary" });
  });
  it("事件加解密往返", () => {
    expect(decryptFeishu(encryptFeishu('{"a":"中文"}', "k"), "k")).toBe('{"a":"中文"}');
    expect(() => decryptFeishu(encryptFeishu("x", "k"), "wrong")).toThrow();
  });
  it("任务完成后推送结果卡片", async () => {
    db().prepare("INSERT INTO tasks(id, config, created_at, status, scope, name, progress) VALUES (50,?,?,?,?,?,?)").run("{}", NOW, "running", "t50", "测试", "{}");
    watchTask(50, "oc_1", sender, "https://mon.example.com", { intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent).toHaveLength(0);
    db().prepare("UPDATE tasks SET status='done', progress=? WHERE id=50").run(JSON.stringify({ accounts: 3, newAccounts: 1, repeatAccounts: 1 }));
    await new Promise((r) => setTimeout(r, 80));
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0].payload)).toContain("命中 3 个账号");
  });
  it("提醒推送：首次只记水位不回放；之后只推新增给订阅会话", async () => {
    addAlert("task_done", "旧提醒");
    db().prepare("INSERT INTO bot_subs(chat_id, created_at) VALUES ('oc_sub', ?)").run(NOW);
    await pushAlertsOnce(sender, "https://mon.example.com");
    expect(sent).toHaveLength(0);
    addAlert("new_repeat", "新晋复投账号", "x 个");
    await pushAlertsOnce(sender, "https://mon.example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0].chat).toBe("oc_sub");
    expect(JSON.stringify(sent[0].payload)).toContain("新晋复投账号");
    await pushAlertsOnce(sender, "https://mon.example.com");
    expect(sent).toHaveLength(1);
  });
});

describe("飞书 API 客户端（mock fetch）", () => {
  it("取 token 并缓存；发送文本/卡片；回复走 reply 接口；失败抛错", async () => {
    const calls: Array<{ url: string; body: any; auth?: string }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const f = (async (url: string, init: RequestInit) => {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      calls.push({ url, body, auth: (init.headers as any)?.Authorization }); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (url.includes("tenant_access_token")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }));
      if (url.includes("fail")) return new Response(JSON.stringify({ code: 230001, msg: "bad" }));
      return new Response(JSON.stringify({ code: 0, data: { file_key: "fk" }, bot: { open_id: "ou_bot" } }));
    }) as unknown as typeof fetch;
    const c = new FeishuClient({ appId: "a", appSecret: "s", baseUrl: "https://open.feishu.cn" }, f);
    await c.text("oc_1", "hi");
    await c.card("oc_1", { x: 1 }, "om_1");
    expect(calls.filter((x) => x.url.includes("tenant_access_token"))).toHaveLength(1);
    expect(calls[1].url).toContain("/im/v1/messages?receive_id_type=chat_id");
    expect(calls[1].auth).toBe("Bearer t-abc");
    expect(calls[1].body).toMatchObject({ msg_type: "text", receive_id: "oc_1", content: JSON.stringify({ text: "hi" }) });
    expect(calls[2].url).toContain("/im/v1/messages/om_1/reply");
    expect(calls[2].body.msg_type).toBe("interactive");
    await c.file("oc_1", "a.xlsx", Buffer.from("PK"));
    expect(calls.some((x) => x.url.endsWith("/im/v1/files"))).toBe(true);
    expect(await c.getBotOpenId()).toBe("ou_bot");
    const bad = new FeishuClient({ appId: "a", appSecret: "s", baseUrl: "https://open.feishu.cn/fail" }, f);
    await expect(bad.text("c", "x")).rejects.toThrow();
  });
});

describe("webhook 路由", () => {
  const call = async (body: unknown) => {
    const { POST } = await import("../src/app/api/feishu/events/route");
    return POST(new Request("http://x/api/feishu/events", { method: "POST", body: JSON.stringify(body) }));
  };
  it("url_verification：token 正确返回 challenge；错误 401", async () => {
    const ok = await call({ type: "url_verification", challenge: "abc", token: "tok123" });
    expect(await ok.json()).toEqual({ challenge: "abc" });
    expect((await call({ type: "url_verification", challenge: "abc", token: "nope" })).status).toBe(401);
  });
  it("加密事件：能解密并校验", async () => {
    const enc = encryptFeishu(JSON.stringify({ type: "url_verification", challenge: "zzz", token: "tok123" }), "enc-key");
    expect(await (await call({ encrypt: enc })).json()).toEqual({ challenge: "zzz" });
    expect((await call({ encrypt: "garbage" })).status).toBe(400);
  });
  it("未配置 token 时拒绝服务，非法 body 400", async () => {
    const { POST } = await import("../src/app/api/feishu/events/route");
    const old = process.env.FEISHU_VERIFICATION_TOKEN;
    delete process.env.FEISHU_VERIFICATION_TOKEN;
    expect((await POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(503);
    process.env.FEISHU_VERIFICATION_TOKEN = old;
    expect((await POST(new Request("http://x", { method: "POST", body: "not json" }))).status).toBe(400);
  });
});

describe("webhook 未配置应用凭证", () => {
  it("收到消息事件但缺 FEISHU_APP_ID/SECRET → 503 而不是 500", async () => {
    delete process.env.FEISHU_APP_ID; delete process.env.FEISHU_APP_SECRET;
    const { POST } = await import("../src/app/api/feishu/events/route");
    const r = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ header: { token: "tok123", event_type: "im.message.receive_v1" }, event: {} }) }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("FEISHU_APP_ID");
  });
});
