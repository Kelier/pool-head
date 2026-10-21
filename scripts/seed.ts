// 演示数据：不调用 TikHub。用法：DB_FILE=/tmp/demo.db node --import tsx scripts/seed.ts
import { db } from "../src/lib/db";
import { saveCompetitor } from "../src/lib/queries";
import { addAlert } from "../src/lib/alerts";

let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const DAY = 86_400_000, NOW = Date.now(), d = db();

const comps = [
  { name: "LibTV", keywords: ["libtv导演台", "libtv"], platforms: ["douyin", "xiaohongshu", "bilibili"] },
  { name: "即梦AI", keywords: ["即梦", "即梦ai"], platforms: ["douyin", "xiaohongshu"] },
  { name: "可灵", keywords: ["可灵ai", "可灵"], platforms: ["douyin", "kuaishou"] },
].map((c) => ({ ...c, id: saveCompetitor(c) }));

const names = "海棠Talk笔记 欧耶学AI 乘舟归故里 阿辰对你说 99m-AIGC 小鹿AI实验室 数字游民阿杰 AI短剧工坊 老K说创作 星河剪辑 视频魔法师 PromptDaily 设计师阿狸 影视飓风2 AI绘画日记 三分钟学剪辑 导演小圆 创意猫 效率工具控 科技小面 爱做视频的猫 超级个体笔记 Kira的工作流 AI搞钱笔记".split(" ");
const accounts = names.map((n, i) => {
  const platform = pick(["douyin", "douyin", "xiaohongshu", "bilibili", "kuaishou"]);
  const followers = Math.round(Math.exp(7 + rnd() * 7.5));
  return { platform, uid: `${platform.slice(0, 2)}_${1000 + i}`, name: n, followers };
});
for (const a of accounts)
  d.prepare("INSERT OR REPLACE INTO accounts(platform, uid, name, profile_url, followers, updated_at) VALUES (?,?,?,?,?,?)").run(a.platform, a.uid, a.name, `https://example.com/${a.uid}`, a.followers, NOW);

const titles = ["用 {k} 做了一条 AI 短剧，全流程分享 #合作", "{k} 实测：分镜到成片只要 10 分钟", "{k} 新功能上线，评论区领取邀请码", "{k} 值不值得用？三个月深度体验", "和 {k} 一起做创作，限时福利", "{k} 教程｜零基础也能上手"];
let postSeq = 0;
function task(compId: number | null, name: string, daysAgo: number, cfg: object, status = "done") {
  const r = d.prepare("INSERT INTO tasks(config, status, progress, created_at, finished_at, competitor_id, name, source, scope) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(JSON.stringify(cfg), status, "{}", NOW - daysAgo * DAY, NOW - daysAgo * DAY + 90_000, compId, name, "manual", "");
  const id = Number(r.lastInsertRowid);
  d.prepare("UPDATE tasks SET scope=? WHERE id=?").run(compId ? `c${compId}` : `t${id}`, id);
  return { id, scope: compId ? `c${compId}` : `t${id}` };
}

for (const c of comps) {
  const cfg = { platforms: c.platforms, keywords: c.keywords, match: "any", time: { type: "relative", days: 60 }, repeatThreshold: 2, maxPages: 3, minConfidence: 0.5 };
  const pool = accounts.filter((a) => c.platforms.includes(a.platform)).filter(() => rnd() < 0.7);
  const seen = new Set<string>();
  [{ ago: 14, until: 0.6 }, { ago: 0, until: 1 }].forEach((t, ti) => {
    const tk = task(c.id, c.name, t.ago, cfg);
    const total = { accounts: new Set<string>(), posts: 0 };
    for (const a of pool.slice(0, Math.round(pool.length * t.until))) {
      const n = rnd() < 0.3 ? 2 + Math.floor(rnd() * 4) : 1;
      for (let i = 0; i < n; i++) {
        const age = ti === 0 ? 14 + rnd() * 40 : rnd() * 55;
        const id = `p${++postSeq}`;
        const key = `${a.uid}:${Math.round(age)}`;
        if (seen.has(key) && ti === 1 && rnd() < 0.5) continue;
        seen.add(key);
        d.prepare(`INSERT OR REPLACE INTO promo_posts(platform, post_id, task_id, scope, account_uid, url, title, published_at, likes, comments, plays, keywords, confidence, reasons, crawled_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.platform, id, tk.id, tk.scope, a.uid, `https://example.com/p/${id}`, pick(titles).replace("{k}", c.name),
          NOW - age * DAY, Math.round(Math.exp(4 + rnd() * 6)), Math.round(Math.exp(2 + rnd() * 4)), 0, JSON.stringify([pick(c.keywords)]),
          Number((0.5 + rnd() * 0.5).toFixed(2)), JSON.stringify(["命中关键词", "推广/合作标识"]), NOW - t.ago * DAY);
        total.posts++;
        total.accounts.add(a.uid);
      }
    }
    d.prepare("UPDATE tasks SET progress=? WHERE id=?").run(JSON.stringify({ stage: "done", calls: 14, postsSeen: total.posts * 4, postsMatched: total.posts, accounts: total.accounts.size, newAccounts: ti ? 6 : total.accounts.size, newRepeat: ti ? 3 : 0, repeatAccounts: ti ? 7 : 2 }), tk.id);
  });
}
// 一个临时任务、一个失败任务、一个运行中任务
const adhoc = task(null, "libtv导演台", 3, { platforms: ["douyin"], keywords: ["libtv导演台"], match: "any", time: { type: "relative", days: 30 }, repeatThreshold: 2, maxPages: 2, minConfidence: 0.5 });
task(comps[0].id, "LibTV", 1, { platforms: ["bilibili"], keywords: ["libtv"], match: "any", time: { type: "relative", days: 30 }, repeatThreshold: 2, maxPages: 3, minConfidence: 0.5 }, "paused_budget");
d.prepare("UPDATE tasks SET error='已达今日调用预算 5000/5000' WHERE status='paused_budget'").run();
void adhoc;
d.prepare("INSERT OR REPLACE INTO account_meta(platform, uid, status, tags, note, updated_at) VALUES (?,?,?,?,?,?)").run(accounts[0].platform, accounts[0].uid, "watch", '["腰部","可合作"]', "报价 8k/条，联系人：小王", NOW);
addAlert("task_done", "「LibTV」抓取完成", "命中 18 个账号，其中新增 6 个", "/tasks/2");
addAlert("new_repeat", "「LibTV」新增 3 个高频复投账号", "这些账号投放次数刚达到复投阈值", "/tasks/2");
addAlert("budget", "今日调用已达预算 82%", "4100 / 5000", "/settings");
const now = Date.now();
for (let i = 0; i < 14; i++) for (let k = 0; k < Math.round(20 + rnd() * 60); k++)
  d.prepare("INSERT INTO api_calls(ts, endpoint, status, ms, cached, attempt) VALUES (?,?,?,?,?,0)").run(now - i * DAY - k * 60_000, pick(["/api/v1/douyin/search/fetch_video_search_v2", "/api/v1/xiaohongshu/app_v2/search_notes", "/api/v1/bilibili/web/fetch_general_search"]), rnd() < 0.03 ? 429 : 200, Math.round(1500 + rnd() * 2500), rnd() < 0.25 ? 1 : 0);
console.log("seeded", { competitors: comps.length, accounts: accounts.length, posts: postSeq });
