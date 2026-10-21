// 本地存储：node:sqlite（Node 22.13+ 内置，无需原生依赖）。线上换 Postgres 时只需替换本文件与 queries.ts。
import type { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

// 用 getBuiltinModule 取 node:sqlite，避免 vite/webpack 解析 node: 前缀失败
const { DatabaseSync: DB } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const g = globalThis as unknown as { __db?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__db) return g.__db;
  const file = process.env.DB_FILE || path.join(process.cwd(), "data", "gtm.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const d = new DB(file);
  d.exec("PRAGMA journal_mode = WAL;");
  migrate(d);
  g.__db = d;
  return d;
}

function addCol(d: DatabaseSync, table: string, col: string, ddl: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#ff1eb4',
      keywords TEXT NOT NULL DEFAULT '[]',
      platforms TEXT NOT NULL DEFAULT '["douyin"]',
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS accounts (
      platform TEXT NOT NULL,
      uid TEXT NOT NULL,
      name TEXT,
      profile_url TEXT,
      followers INTEGER,
      category TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, uid)
    );
    CREATE TABLE IF NOT EXISTS promo_posts (
      platform TEXT NOT NULL,
      post_id TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      account_uid TEXT NOT NULL,
      url TEXT,
      title TEXT,
      published_at INTEGER,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      plays INTEGER DEFAULT 0,
      keywords TEXT NOT NULL,
      confidence REAL NOT NULL,
      reasons TEXT,
      crawled_at INTEGER NOT NULL,
      PRIMARY KEY (platform, post_id, task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_account ON promo_posts(platform, account_uid);
    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      status INTEGER,
      ms INTEGER,
      cached INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 0,
      task_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 7,
      window_days INTEGER NOT NULL DEFAULT 30,
      max_pages INTEGER NOT NULL DEFAULT 3,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_meta (
      platform TEXT NOT NULL,
      uid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'none',
      tags TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, uid)
    );
    CREATE TABLE IF NOT EXISTS post_flags (
      platform TEXT NOT NULL,
      post_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (platform, post_id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_subs (
      chat_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    -- 机器人：多轮上下文（按 会话:用户）、待确认的修改类操作、大模型用量（按天按人，重启不丢）
    CREATE TABLE IF NOT EXISTS bot_sessions (
      key TEXT PRIMARY KEY,
      turns TEXT NOT NULL DEFAULT '[]',
      last TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_pending (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      summary TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_llm_usage (
      day TEXT NOT NULL,
      user_id TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, user_id)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      href TEXT,
      read INTEGER NOT NULL DEFAULT 0
    );
  `);
  // 旧表补列（scope: 竞品任务为 c<竞品id>，临时任务为 t<任务id>，用于跨任务去重聚合）
  addCol(d, "tasks", "competitor_id", "INTEGER");
  addCol(d, "tasks", "name", "TEXT");
  addCol(d, "tasks", "source", "TEXT NOT NULL DEFAULT 'manual'");
  addCol(d, "tasks", "cancel", "INTEGER NOT NULL DEFAULT 0");
  addCol(d, "tasks", "scope", "TEXT");
  addCol(d, "tasks", "schedule_id", "INTEGER");
  addCol(d, "promo_posts", "scope", "TEXT");
  d.exec(`
    UPDATE tasks SET scope = 't' || id WHERE scope IS NULL;
    UPDATE promo_posts SET scope = 't' || task_id WHERE scope IS NULL;
    CREATE INDEX IF NOT EXISTS idx_posts_scope ON promo_posts(scope);
    CREATE INDEX IF NOT EXISTS idx_posts_task ON promo_posts(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_competitor ON tasks(competitor_id);
    CREATE INDEX IF NOT EXISTS idx_calls_ts ON api_calls(ts);
  `);
  // 一次性换肤：旧默认色板 → 品牌色板（仅替换未自定义的旧值）
  const OLD: Array<[string, string]> = [["#4f46e5", "#ff1eb4"], ["#0ea5e9", "#579df8"], ["#10b981", "#2fd4a0"], ["#f59e0b", "#f5b83d"], ["#ef4444", "#ff7b71"], ["#8b5cf6", "#be6aff"], ["#ec4899", "#8fd14f"], ["#14b8a6", "#1fc8c8"]];
  for (const [from, to] of OLD) d.prepare("UPDATE competitors SET color = ? WHERE color = ?").run(to, from);
  // 服务重启时，遗留的 running/pending 任务视为中断
  d.prepare("UPDATE tasks SET status='interrupted', error='服务重启，任务中断，可点击重跑', finished_at=? WHERE status IN ('running','pending')").run(Date.now());
}
