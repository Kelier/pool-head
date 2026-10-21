// 端到端冒烟：真实调用 TikHub（约 4 次搜索 + 若干资料补全）。用法：pnpm smoke
import { db } from "../src/lib/db";
import { runTask, estimateCalls } from "../src/lib/pipeline";
import { accountRows } from "../src/lib/queries";
import { parseTaskConfig } from "../src/lib/validate";

const cfg = parseTaskConfig({
  platforms: (process.env.SMOKE_PLATFORMS ?? "douyin,xiaohongshu").split(","),
  keywords: [process.argv[2] ?? "libtv导演台"],
  time: { type: "relative", days: 30 },
  maxPages: 2,
  repeatThreshold: 2,
});
console.log("预估调用", estimateCalls(cfg));
const t0 = Date.now();
const id = Number(db().prepare("INSERT INTO tasks(config, created_at, scope) VALUES (?,?,?)").run(JSON.stringify(cfg), Date.now(), "").lastInsertRowid);
db().prepare("UPDATE tasks SET scope=? WHERE id=?").run(`t${id}`, id);
await runTask(id);
const task = db().prepare("SELECT status, error, progress FROM tasks WHERE id=?").get(id);
console.log("任务", task, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
const accs = accountRows({ taskId: id });
console.table(accs.map((a) => ({ 平台: a.platform, 账号: a.name, 粉丝: a.followers, 次数: a.promoCount, 标签: a.label, 复投: a.isRepeat })));
const calls = db().prepare("SELECT endpoint, status, COUNT(*) n, ROUND(AVG(ms)) ms FROM api_calls WHERE task_id=? GROUP BY 1,2").all(id);
console.table(calls);
