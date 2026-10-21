// 导出体系：把"屏幕上的数据"抽象成 Sheet[]，再渲染成 CSV / Excel / JSON / 打印页（PDF）。
/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from "exceljs";
import { db } from "./db";
import { toCsv } from "./csv";
import { parseAccountFilter } from "./params";
import { PLATFORM_NAME, TIER_LABEL, ACCOUNT_STATUS } from "./consts";
import { accountRows, compareCompetitors, compareTasks, getCompetitor, getTask, listCompetitors, summarize, type AccountRow } from "./queries";

export const EXPORT_TYPES = ["accounts", "posts", "compare-tasks", "compare-competitors", "report"] as const;
export const EXPORT_FORMATS = ["csv", "xlsx", "pdf", "json"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportType = (v: unknown): v is ExportType => EXPORT_TYPES.includes(v as ExportType);
export const isExportFormat = (v: unknown): v is ExportFormat => EXPORT_FORMATS.includes(v as ExportFormat);

export type Column<R = any> = {
  header: string;
  get: (row: R) => unknown;
  /** int: 数字；date: 毫秒时间戳；link: URL（Excel 里是超链接）；缺省为文本 */
  fmt?: "int" | "date" | "link";
  width?: number;
  /** 打印/PDF 版隐藏（长链接、UID 等纸面上没用的列），Excel/CSV/JSON 仍保留 */
  noPrint?: boolean;
};
export type Sheet<R = any> = { name: string; title?: string; columns: Column<R>[]; rows: R[] };
export type Built = { filename: string; title: string; filters: string[]; sheets: Sheet[] };

const pn = (p: string) => PLATFORM_NAME[p] ?? p;
const tier = (t: string) => TIER_LABEL[t] ?? t;
const num = (v: string | null) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const stamp = () => new Date().toISOString().slice(0, 10);

/* ───────── 列定义 ───────── */
const accountColumns: Column<AccountRow>[] = [
  { header: "账号", get: (a) => a.name },
  { header: "平台", get: (a) => pn(a.platform) },
  { header: "UID", noPrint: true, get: (a) => a.uid },
  { header: "主页链接", noPrint: true, get: (a) => a.profileUrl, fmt: "link" },
  { header: "粉丝数", get: (a) => a.followers, fmt: "int" },
  { header: "层级", get: (a) => tier(a.tier) },
  { header: "投放总次数", get: (a) => a.promoCount, fmt: "int" },
  { header: "单竞品最高次数", noPrint: true, get: (a) => a.maxRepeat, fmt: "int" },
  { header: "频次标签", get: (a) => a.label },
  { header: "高频复投", get: (a) => (a.isRepeat ? "是" : "否") },
  { header: "涉及竞品", get: (a) => a.competitors.map((c) => `${c.name}×${c.count}`).join("；") },
  { header: "首次投放", get: (a) => a.firstAt, fmt: "date" },
  { header: "最近投放", get: (a) => a.lastAt, fmt: "date" },
  { header: "均赞", get: (a) => a.avgLikes, fmt: "int" },
  { header: "均评", get: (a) => a.avgComments, fmt: "int" },
  { header: "命中关键词", get: (a) => a.keywords.join("；") },
  { header: "运营状态", get: (a) => ACCOUNT_STATUS[a.status] ?? a.status },
  { header: "标签", noPrint: true, get: (a) => a.tags.join("；") },
  { header: "备注", noPrint: true, get: (a) => a.note },
  { header: "抓取时间", noPrint: true, get: (a) => a.crawledAt, fmt: "date" },
];

type PostRow = {
  account: AccountRow; competitor: string; title: string; url: string; publishedAt: number; likes: number; comments: number;
  plays: number; keywords: string[]; confidence: number; reasons: string[];
};
const postColumns: Column<PostRow>[] = [
  { header: "账号", get: (r) => r.account.name },
  { header: "平台", get: (r) => pn(r.account.platform) },
  { header: "粉丝数", get: (r) => r.account.followers, fmt: "int" },
  { header: "竞品", get: (r) => r.competitor },
  { header: "作品标题", get: (r) => r.title, width: 48 },
  { header: "作品链接", noPrint: true, get: (r) => r.url, fmt: "link" },
  { header: "发布时间", get: (r) => r.publishedAt, fmt: "date" },
  { header: "点赞", get: (r) => r.likes, fmt: "int" },
  { header: "评论", get: (r) => r.comments, fmt: "int" },
  { header: "播放", noPrint: true, get: (r) => r.plays, fmt: "int" },
  { header: "命中关键词", get: (r) => r.keywords.join("；") },
  { header: "置信度", get: (r) => r.confidence },
  { header: "判定依据", noPrint: true, get: (r) => r.reasons.join("；") },
];

/**
 * 作品明细：与 queries.ts 的口径一致（按 scope 去重、剔除人工否决），但一次 SQL 取全，
 * 避免对每个账号调用 accountDetail（后者每次都会重算全库聚合，O(n²)）。
 */
function postRows(f: ReturnType<typeof parseAccountFilter>, accounts: AccountRow[]): PostRow[] {
  const scope = f.scope ?? (f.competitorId ? `c${f.competitorId}` : undefined);
  const where: string[] = ["NOT EXISTS (SELECT 1 FROM post_flags x WHERE x.platform = p.platform AND x.post_id = p.post_id AND x.verdict = 'rejected')"];
  const args: any[] = [];
  if (f.taskId) (where.push("p.task_id = ?"), args.push(f.taskId));
  else if (scope) (where.push("p.rowid IN (SELECT MAX(rowid) FROM promo_posts WHERE scope = ? GROUP BY platform, post_id)"), args.push(scope));
  else where.push("p.rowid IN (SELECT MAX(rowid) FROM promo_posts GROUP BY platform, post_id, scope)");
  const raw = db().prepare(`SELECT p.* FROM promo_posts p WHERE ${where.join(" AND ")} ORDER BY p.published_at DESC`).all(...args) as any[];
  const byKey = new Map(accounts.map((a) => [`${a.platform}:${a.uid}`, a]));
  const comps = new Map(listCompetitors().map((c) => [`c${c.id}`, c.name]));
  const out: PostRow[] = [];
  for (const p of raw) {
    const account = byKey.get(`${p.platform}:${p.account_uid}`);
    if (!account) continue;
    out.push({
      account, competitor: comps.get(p.scope) ?? "", title: p.title ?? "", url: p.url ?? "", publishedAt: p.published_at,
      likes: p.likes ?? 0, comments: p.comments ?? 0, plays: p.plays ?? 0, keywords: JSON.parse(p.keywords ?? "[]"),
      confidence: p.confidence, reasons: p.reasons ? JSON.parse(p.reasons) : [],
    });
  }
  return out;
}

/** 把筛选参数翻成人话，用于打印页抬头。 */
function describeFilters(sp: URLSearchParams): string[] {
  const out: string[] = [];
  const task = num(sp.get("task"));
  if (task) out.push(`任务：#${task} ${getTask(task)?.name ?? ""}`.trim());
  const cs = num(sp.get("competitorScope"));
  if (cs) out.push(`竞品：${getCompetitor(cs)?.name ?? `#${cs}`}`);
  const c = num(sp.get("competitor"));
  if (c) out.push(`涉及竞品：${getCompetitor(c)?.name ?? `#${c}`}`);
  if (sp.get("platform")) out.push(`平台：${pn(sp.get("platform")!)}`);
  if (sp.get("tier")) out.push(`层级：${tier(sp.get("tier")!)}`);
  if (sp.get("status")) out.push(`运营状态：${ACCOUNT_STATUS[sp.get("status")!] ?? sp.get("status")}`);
  if (sp.get("tag")) out.push(`标签：${sp.get("tag")}`);
  if (sp.get("q")) out.push(`搜索：${sp.get("q")}`);
  if (sp.get("repeat") === "1") out.push("仅高频复投");
  if (sp.get("fMin") || sp.get("fMax")) out.push(`粉丝：${sp.get("fMin") || 0} – ${sp.get("fMax") || "不限"}`);
  return out;
}

/* ───────── 各导出类型 ───────── */
export function buildSheets(type: ExportType, sp: URLSearchParams): Built {
  if (type === "accounts" || type === "posts") {
    const f = parseAccountFilter(sp);
    const rows = accountRows(f);
    const filters = describeFilters(sp);
    if (type === "accounts") {
      return { filename: `投放账号-${stamp()}`, title: "投放账号列表", filters, sheets: [{ name: "账号列表", columns: accountColumns, rows }] };
    }
    return { filename: `作品明细-${stamp()}`, title: "投放作品明细", filters, sheets: [{ name: "作品明细", columns: postColumns, rows: postRows(f, rows) }] };
  }

  if (type === "compare-tasks") {
    const a = num(sp.get("a")), b = num(sp.get("b"));
    if (!a || !b) throw new Error("缺少对比的任务参数 a、b");
    const c = compareTasks(a, b);
    type Card = (typeof c.added)[number];
    const base = (): Column<any>[] => [
      { header: "账号", get: (r) => r.x.name },
      { header: "平台", get: (r) => pn(r.x.platform) },
      { header: "粉丝数", get: (r) => r.x.followers, fmt: "int" },
      { header: "层级", get: (r) => tier(r.x.tier) },
    ];
    const tail: Column<any> = { header: "主页", noPrint: true, get: (r) => r.x.profileUrl, fmt: "link" };
    const flat = [
      ...c.added.map((x: Card) => ({ change: "新增", x, before: null as number | null, after: x.count })),
      ...c.lost.map((x: Card) => ({ change: "流失", x, before: x.count as number | null, after: null as number | null })),
      ...c.kept.map((x) => ({ change: x.upgraded ? "新晋复投" : "持续", x, before: x.before as number | null, after: x.after as number | null })),
    ];
    const ba: Column<any>[] = [
      { header: "旧任务次数", get: (r) => r.before, fmt: "int" },
      { header: "新任务次数", get: (r) => r.after, fmt: "int" },
    ];
    const wrap = (arr: any[], mk: (x: any) => any) => arr.map(mk);
    return {
      filename: `任务对比-${a}-vs-${b}-${stamp()}`,
      title: `任务对比：#${a} ${c.a.name ?? ""} → #${b} ${c.b.name ?? ""}`.replace(/\s+→/, " →"),
      filters: [`旧任务 #${a}（账号 ${c.a.accounts}，复投 ${c.a.repeat}）`, `新任务 #${b}（账号 ${c.b.accounts}，复投 ${c.b.repeat}）`],
      sheets: [
        // 第一张表保持与旧版 CSV 一致（扁平，带"变化"列），CSV 只会导出第一张
        { name: "全部变化", columns: [{ header: "变化", get: (r: any) => r.change }, ...base(), ...ba, tail], rows: flat },
        { name: "新增", columns: [...base(), { header: "投放次数", get: (r: any) => r.x.count, fmt: "int" }, tail], rows: wrap(c.added, (x) => ({ x })) },
        { name: "流失", columns: [...base(), { header: "原投放次数", get: (r: any) => r.x.count, fmt: "int" }, tail], rows: wrap(c.lost, (x) => ({ x })) },
        { name: "持续", columns: [...base(), ...ba, { header: "变化", get: (r: any) => r.x.delta, fmt: "int" }, tail], rows: wrap(c.kept, (x) => ({ x, before: x.before, after: x.after })) },
        { name: "新晋复投", columns: [...base(), ...ba, tail], rows: wrap(c.upgraded, (x) => ({ x, before: x.before, after: x.after })) },
      ],
    };
  }

  if (type === "compare-competitors") {
    const ids = (sp.get("ids") ?? "").split(",").map(Number).filter(Boolean);
    const c = compareCompetitors(ids);
    type Shared = (typeof c.shared)[number];
    return {
      filename: `竞品对比-${stamp()}`,
      title: `竞品对比：${c.competitors.map((k) => k.name).join(" vs ")}`,
      filters: c.competitors.map((k) => `${k.name}：账号 ${k.accounts}，独占 ${k.exclusive}，复投 ${k.repeat}`),
      sheets: [
        {
          name: "共同KOL",
          columns: [
            { header: "共同账号", get: (r: Shared) => r.name },
            { header: "平台", get: (r: Shared) => pn(r.platform) },
            { header: "粉丝数", get: (r: Shared) => r.followers, fmt: "int" },
            { header: "层级", get: (r: Shared) => tier(r.tier) },
            ...c.competitors.map((k): Column<Shared> => ({ header: `${k.name} 投放次数`, get: (r) => r.counts[k.id] ?? 0, fmt: "int" })),
            { header: "合计", get: (r: Shared) => r.total, fmt: "int" },
            { header: "主页", noPrint: true, get: (r: Shared) => r.profileUrl, fmt: "link" },
          ],
          rows: c.shared,
        },
        {
          name: "竞品摘要",
          columns: [
            { header: "竞品", get: (k: (typeof c.competitors)[number]) => k.name },
            { header: "投放账号", get: (k: (typeof c.competitors)[number]) => k.accounts, fmt: "int" },
            { header: "独占账号", get: (k: (typeof c.competitors)[number]) => k.exclusive, fmt: "int" },
            { header: "高频复投", get: (k: (typeof c.competitors)[number]) => k.repeat, fmt: "int" },
            { header: "命中作品", get: (k: (typeof c.competitors)[number]) => k.posts, fmt: "int" },
            { header: "近7天新增", get: (k: (typeof c.competitors)[number]) => k.newThisWeek, fmt: "int" },
          ],
          rows: c.competitors,
        },
      ],
    };
  }

  // report：竞品监测汇总
  const id = num(sp.get("id"));
  const comp = id ? getCompetitor(id) : null;
  if (!comp) throw new Error("竞品不存在（缺少或错误的 id 参数）");
  const rows = accountRows({ competitorId: comp.id });
  const s = summarize(rows);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const f = { competitorId: comp.id } as ReturnType<typeof parseAccountFilter>;
  const kv: Array<{ k: string; v: string | number }> = [
    { k: "竞品", v: comp.name },
    { k: "监测关键词", v: comp.keywords.join("、") },
    { k: "监测平台", v: comp.platforms.map(pn).join("、") },
    { k: "投放账号数", v: s.accounts },
    { k: "高频复投账号", v: s.repeat },
    { k: "复投率", v: `${(s.repeatRate * 100).toFixed(1)}%` },
    { k: "命中投放作品", v: s.posts },
    { k: "近7天新增账号", v: s.newThisWeek },
    { k: "头部 / 腰部 / 尾部 / 素人", v: `${s.tiers.head} / ${s.tiers.waist} / ${s.tiers.tail} / ${s.tiers.micro}` },
    { k: "报告生成时间", v: new Date().toLocaleString("zh-CN", { hour12: false }) },
  ];
  return {
    filename: `监测报告-${comp.name}-${stamp()}`,
    title: `竞品投放监测报告：${comp.name}`,
    filters: [`监测关键词：${comp.keywords.join("、")}`, `平台：${comp.platforms.map(pn).join("、")}`],
    sheets: [
      { name: "概览指标", columns: [{ header: "指标", get: (r: any) => r.k }, { header: "数值", get: (r: any) => r.v }], rows: kv },
      { name: "高频复投Top", columns: accountColumns, rows: rows.filter((a) => a.isRepeat).slice(0, 15) },
      { name: "近7天新增", columns: accountColumns, rows: rows.filter((a) => a.firstSeenAt >= weekAgo) },
      { name: "作品明细", columns: postColumns, rows: postRows(f, rows) },
    ],
  };
}

/* ───────── 渲染器 ───────── */
const dtFmt = (t: unknown) => (typeof t === "number" && t > 0 ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "");

/** 单元格的文本形态（CSV / 打印页 / 列宽估算共用）。 */
export function cellText(col: Column, row: unknown, opts: { dateOnly?: boolean } = {}): string {
  const v = col.get(row);
  if (v == null) return "";
  if (col.fmt === "date") return opts.dateOnly && typeof v === "number" && v > 0 ? new Date(v).toLocaleDateString("zh-CN") : dtFmt(v);
  return String(v);
}

/** 防公式注入：以 = + - @ Tab CR 开头且不是纯数字的字符串加 ' 前缀。 */
export const guard = (s: string) => (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s);

/** CSV：多 sheet 时只导出第一张（Excel 才是多表格式）。 */
export function renderCsv(b: Built): string {
  const sh = b.sheets[0];
  return toCsv(sh.columns.map((c): [string, (r: any) => unknown] => [c.header, (r) => cellText(c, r)]), sh.rows);
}

export function renderJson(b: Built): string {
  const out = {
    title: b.title,
    generatedAt: new Date().toISOString(),
    filters: b.filters,
    sheets: Object.fromEntries(
      b.sheets.map((s) => [
        s.name,
        s.rows.map((r) => Object.fromEntries(s.columns.map((c) => [c.header, c.fmt === "date" && typeof c.get(r) === "number" ? new Date(c.get(r) as number).toISOString() : (c.get(r) ?? null)]))),
      ]),
    ),
  };
  return JSON.stringify(out, null, 2);
}

// CJK 字符在 Excel 里约占 2 个字符宽
const visualLen = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);

export async function renderXlsx(b: Built): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "竞品投放监测";
  wb.created = new Date();
  const used = new Set<string>();
  for (const s of b.sheets) {
    // sheet 名限制：≤31 字符，不含 : \ / ? * [ ]，且不重复
    let name = s.name.replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Sheet";
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 28)}_${i}`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.header, width: 10 }));
    for (const r of s.rows) {
      const row = ws.addRow(
        s.columns.map((c) => {
          const v = c.get(r);
          if (v == null || v === "") return null;
          if (c.fmt === "date") return typeof v === "number" && v > 0 ? new Date(v) : null;
          if (c.fmt === "int") return typeof v === "number" ? v : (Number.isFinite(Number(v)) ? Number(v) : guard(String(v)));
          if (c.fmt === "link") return /^https?:\/\//i.test(String(v)) ? { text: String(v), hyperlink: String(v) } : guard(String(v));
          return typeof v === "string" ? guard(v) : v; // 数字等保持原类型
        }) as any[],
      );
      s.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c.fmt === "date") cell.numFmt = "yyyy-mm-dd hh:mm";
        if (c.fmt === "int") (cell.numFmt = "#,##0"), (cell.alignment = { horizontal: "right" });
        if (c.fmt === "link" && cell.value) cell.font = { color: { argb: "FF4F46E5" }, underline: true };
      });
    }
    // 列宽自适应：表头与前 200 行内容里取最大视觉宽度，限制 8–50
    s.columns.forEach((c, i) => {
      let w = visualLen(c.header) + 3;
      for (const r of s.rows.slice(0, 200)) w = Math.max(w, visualLen(cellText(c, r)) + 2);
      let width = c.width ?? Math.min(50, Math.max(8, Math.ceil(w)));
      if (width === 9) width = 9.01; // exceljs 把恰为默认宽度 9 的列视为"默认列"，不写入 <cols>，这里错开
      ws.getColumn(i + 1).width = width;
    });
    const head = ws.getRow(1);
    head.height = 22;
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FF111827" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      cell.alignment = { vertical: "middle", horizontal: s.columns[Number(cell.col) - 1]?.fmt === "int" ? "right" : "left" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });
    if (s.rows.length && s.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Content-Disposition：ASCII 回退 + RFC 5987 的 UTF-8 文件名（中文）。 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
