"use client";
import { useState } from "react";
import { estimateSearchPages, MAX_SEARCH_PAGES } from "@/lib/search-pages";
import { PLATFORM_LIST } from "@/lib/consts";
import { api } from "@/lib/useApi";
import { Modal, Seg } from "./ui";

export type Preset = { competitorId?: number; name?: string; keywords?: string[]; platforms?: string[] };

const NEEDS_ENRICH = new Set(["xiaohongshu", "kuaishou", "bilibili", "wechat_channels"]); // 需额外调用补粉丝数

/** 新建抓取任务（临时任务或指定竞品）。预估调用量与服务端公式一致。 */
export function NewTaskModal({ preset, onClose, onCreated }: { preset?: Preset; onClose: () => void; onCreated: (id: number) => void }) {
  const [platforms, setPlatforms] = useState<string[]>(preset?.platforms ?? ["douyin"]);
  const [keywords, setKeywords] = useState((preset?.keywords ?? []).join("\n"));
  const [match, setMatch] = useState<"any" | "all">("any");
  const [mode, setMode] = useState<"relative" | "absolute">("relative");
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [fMin, setFMin] = useState("");
  const [fMax, setFMax] = useState("");
  const [minLikes, setMinLikes] = useState("");
  const [minComments, setMinComments] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const kws = [...new Set(keywords.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean))];
  const estimatePages = pageOverride ?? estimateSearchPages(platforms.length, kws.length);
  const searchEstimate = platforms.length * kws.length * estimatePages;
  const estimate = searchEstimate + platforms.filter((p) => NEEDS_ENRICH.has(p)).length * Math.min(100, kws.length * estimatePages * 12);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ id: number }>("/api/tasks", "POST", {
        competitorId: preset?.competitorId, name: preset?.name, platforms, keywords: kws, match, maxPages: pageOverride,
        time: mode === "relative" ? { type: "relative", days } : { type: "absolute", from, to },
        followers: fMin || fMax ? { min: fMin, max: fMax } : undefined,
        engagement: minLikes || minComments ? { minLikes, minComments } : undefined,
      });
      onCreated(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={preset?.name ? `抓取「${preset.name}」` : "新建抓取任务"}
      onClose={onClose}
      footer={
        <>
          <span className="hint" style={{ marginRight: "auto", alignSelf: "center" }}>{pageOverride === null ? "自动翻页" : `搜索最多 ${searchEstimate} 次`}，含补资料预算参考约 {estimate} 次</span>
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn" onClick={submit} disabled={busy || !kws.length || !platforms.length || (mode === "absolute" && (!from || !to))}>{busy ? "创建中…" : "开始抓取"}</button>
        </>
      }
    >
      <div className="field">
        <span className="label">平台</span>
        <div className="chips">
          {PLATFORM_LIST.map((p) => (
            <button key={p.id} type="button" className={`chip ${platforms.includes(p.id) ? "on" : ""}`}
              onClick={() => setPlatforms(platforms.includes(p.id) ? platforms.filter((x) => x !== p.id) : [...platforms, p.id])}>{p.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="nt-kw">关键词</label>
        <textarea id="nt-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"竞品名称、产品功能词\n逗号或换行分隔，最多 10 个"} />
        <Seg value={match} onChange={setMatch} options={[["any", "包含任意关键词"], ["all", "包含全部关键词"]]} />
      </div>
      <div className="field">
        <span className="label">时间范围</span>
        <Seg value={mode} onChange={setMode} options={[["relative", "相对时间"], ["absolute", "指定日期"]]} />
        {mode === "relative" ? (
          <div className="chips">
            {[7, 30, 90, 180].map((d) => <button key={d} type="button" className={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>{d === 180 ? "近半年" : `近${d}天`}</button>)}
          </div>
        ) : (
          <div className="row2"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        )}
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 12 }}>高级过滤（可选）</summary>
        <div className="row2">
          <div className="field"><label>粉丝下限</label><input type="number" value={fMin} onChange={(e) => setFMin(e.target.value)} /></div>
          <div className="field"><label>粉丝上限</label><input type="number" value={fMax} onChange={(e) => setFMax(e.target.value)} /></div>
          <div className="field"><label>点赞下限</label><input type="number" value={minLikes} onChange={(e) => setMinLikes(e.target.value)} /></div>
          <div className="field"><label>评论下限</label><input type="number" value={minComments} onChange={(e) => setMinComments(e.target.value)} /></div>
        </div>
        <div className="field">
          <label>每个平台 × 关键词的页数限制（留空自动翻页）</label>
          <input type="number" min={1} max={MAX_SEARCH_PAGES} placeholder="自动" value={pageOverride ?? ""} onChange={(e) => setPageOverride(e.target.value ? Math.min(MAX_SEARCH_PAGES, Math.max(1, Math.floor(Number(e.target.value)))) : null)} />
        </div>
      </details>
      {err && <div className="alert">{err}</div>}
    </Modal>
  );
}
