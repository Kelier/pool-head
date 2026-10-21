import { notFound } from "next/navigation";
import { buildSheets, cellText, isExportType } from "@/lib/export";
import { PrintButton } from "../_PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "导出预览" };

// 打印 / PDF 专用版：/print/<type>?<与 /api/export 相同的参数>。
// 纸张是固定的浅色，不跟随系统深色模式，保证无头 Chrome 与浏览器打印结果一致。
const CSS = `
@page { size: A4 landscape; margin: 12mm; }
.pv { background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 10px; padding: 28px 32px; max-width: 1280px;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif; }
.pv h1 { font-size: 20px; margin: 0 0 4px; color: #111827; }
.pv h2 { font-size: 14px; margin: 22px 0 8px; color: #111827; break-after: avoid; }
.pv .meta { color: #6b7280; font-size: 12px; }
.pv .meta span + span::before { content: " · "; }
.pv .pv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 8px; }
.pv table { border-collapse: collapse; width: 100%; font-size: 11px; }
.pv thead { display: table-header-group; }
.pv th { text-align: left; background: #f1f5f9; color: #334155; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #cbd5e1; white-space: nowrap; }
.pv td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; color: #111827; }
.pv tr { break-inside: avoid; }
.pv .r { text-align: right; font-variant-numeric: tabular-nums; }
.pv .nw { white-space: nowrap; }
.pv .pv-empty { color: #6b7280; padding: 12px 0; }
.pv .foot { margin-top: 18px; color: #9ca3af; font-size: 11px; }
@media print { .pv { border: 0; border-radius: 0; padding: 0; max-width: none; } }
`;

export default async function PrintPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { type } = await params;
  if (!isExportType(type)) notFound();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") sp.set(k, v);
  const now = new Date().toLocaleString("zh-CN", { hour12: false });

  let built;
  try {
    built = buildSheets(type, sp);
  } catch (e) {
    return (
      <div className="pv">
        <style>{CSS}</style>
        <h1>无法生成预览</h1>
        <p className="meta">{(e as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="pv">
      <style>{CSS}</style>
      <div className="pv-head">
        <div>
          <h1>{built.title}</h1>
          <div className="meta">
            <span>生成时间 {now}</span>
            {built.filters.map((f) => <span key={f}>{f}</span>)}
          </div>
        </div>
        <PrintButton />
      </div>
      {built.sheets.map((s) => (
        <section key={s.name}>
          {built.sheets.length > 1 && <h2>{s.name}（{s.rows.length}）</h2>}
          {s.rows.length === 0 ? (
            <div className="pv-empty">暂无数据</div>
          ) : (
            <table>
              <thead>
                <tr>{s.columns.filter((c) => !c.noPrint).map((c) => <th key={c.header} className={c.fmt === "int" ? "r" : undefined}>{c.header}</th>)}</tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={i}>
                    {s.columns.filter((c) => !c.noPrint).map((c) => {
                      const t = cellText(c, r, { dateOnly: true });
                      // 数字/日期/短文本不折行，长文本（标题、关键词等）才折行
                      const short = c.fmt === "int" || c.fmt === "date" || [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) <= 14;
                      return <td key={c.header} className={[c.fmt === "int" ? "r" : "", short ? "nw" : ""].join(" ").trim() || undefined}>{t}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <div className="foot">共 {built.sheets.reduce((n, s) => n + s.rows.length, 0)} 行 · 竞品投放监测</div>
    </div>
  );
}
