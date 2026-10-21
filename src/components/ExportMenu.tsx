"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/useApi";
import { Icon } from "./ui";

type Fmt = "xlsx" | "csv" | "pdf" | "json";
export type ExportItem = {
  label: string;
  type: string;
  format?: Fmt;
  hint?: string;
  /** 覆盖默认的筛选 query（如监测报告只需要 id=<竞品id>） */
  query?: string;
};
type Group = { title?: string; items: ExportItem[] };

const FMT: Record<Fmt, { badge: string; color: string; hint: string }> = {
  xlsx: { badge: "XLS", color: "var(--ok)", hint: "Excel 工作簿，带表头与筛选" },
  csv: { badge: "CSV", color: "var(--info)", hint: "Excel 直接打开不乱码" },
  pdf: { badge: "PDF", color: "var(--hot)", hint: "适合分享 / 打印" },
  json: { badge: "JSON", color: "var(--warn)", hint: "给程序使用" },
};
const FMT_NAME: Record<Fmt, string> = { xlsx: "Excel (.xlsx)", csv: "CSV", pdf: "PDF", json: "JSON" };
const MULTI_SHEET = new Set(["report", "compare-tasks", "compare-competitors"]);

/** query 里带 competitorScope=<id> 时（竞品详情页），额外提供监测报告。 */
function defaultGroups(query: string): Group[] {
  const groups: Group[] = [
    { title: "账号列表", items: (["xlsx", "csv", "pdf", "json"] as Fmt[]).map((f) => ({ label: FMT_NAME[f], type: "accounts", format: f })) },
    { title: "作品明细", items: (["xlsx", "csv"] as Fmt[]).map((f) => ({ label: FMT_NAME[f], type: "posts", format: f })) },
  ];
  const scope = new URLSearchParams(query).get("competitorScope");
  if (scope && /^\d+$/.test(scope)) {
    groups.unshift({
      title: "监测报告",
      items: (["pdf", "xlsx"] as Fmt[]).map((f) => ({
        label: FMT_NAME[f], type: "report", format: f, query: `id=${scope}`,
        hint: f === "pdf" ? "竞品汇总报告，适合汇报" : "含概览、复投 Top、新增、作品明细多个工作表",
      })),
    });
  }
  return groups;
}

const hrefOf = (it: ExportItem, query: string) => {
  const q = it.query ?? query;
  return `/api/export?type=${encodeURIComponent(it.type)}&format=${it.format ?? "csv"}${q ? `&${q}` : ""}`;
};
const keyOf = (it: ExportItem) => `${it.type}:${it.format ?? "csv"}:${it.label}`;

function filenameFrom(res: Response, fallback: string) {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  try {
    return m ? decodeURIComponent(m[1]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 导出下拉：query 是当前筛选条件（不含 ? 与 type/format），导出结果与屏幕所见一致。
 * 可传 items 自定义菜单（平铺展示）；不传则按默认分组展示。
 */
export function ExportMenu({ query = "", items }: { query?: string; items?: ExportItem[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const groups: Group[] = items ? [{ items }] : defaultGroups(query);

  async function downloadPdf(it: ExportItem) {
    const k = keyOf(it);
    setBusy(k);
    try {
      const res = await fetch(hrefOf(it, query));
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `导出失败（HTTP ${res.status}）`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filenameFrom(res, "export.pdf");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast("PDF 已生成");
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  }

  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: 0,
    background: "transparent", color: "var(--text)", textAlign: "left", textDecoration: "none", cursor: "pointer", font: "inherit",
  };

  return (
    <div ref={root} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="download" />导出
      </button>
      {open && (
        <div role="menu" className="card"
          style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, width: 300, padding: 6, boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}>
          {groups.map((g, gi) => (
            <div key={g.title ?? gi}>
              {g.title && (
                <div style={{ padding: "8px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", color: "var(--muted)" }}>{g.title}</div>
              )}
              {g.items.map((it) => {
                const f = it.format ?? "csv";
                const meta = FMT[f];
                const k = keyOf(it);
                const hint = it.hint ?? (f === "xlsx" && MULTI_SHEET.has(it.type) ? "含多个工作表" : meta.hint);
                const content = (
                  <>
                    <span
                      style={{
                        flex: "none", width: 38, textAlign: "center", fontSize: 11, fontWeight: 700, padding: "3px 0", borderRadius: 6,
                        color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                      }}
                    >
                      {meta.badge}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontWeight: 600 }}>{busy === k ? "生成中…" : it.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--text-2)" }}>{hint}</span>
                    </span>
                  </>
                );
                return f === "pdf" ? (
                  <button key={k} type="button" role="menuitem" style={{ ...row, opacity: busy && busy !== k ? 0.5 : 1 }} disabled={!!busy}
                    onClick={() => downloadPdf(it)} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    {content}
                  </button>
                ) : (
                  <a key={k} role="menuitem" href={hrefOf(it, query)} download style={row} onClick={() => setOpen(false)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    {content}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
