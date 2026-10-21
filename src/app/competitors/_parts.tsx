"use client";
import { useState } from "react";
import { PLATFORM_LIST } from "@/lib/consts";
import { api, toast } from "@/lib/useApi";
import { Modal } from "@/components/ui";

export type CompetitorInput = { id?: number; name: string; color: string; keywords: string[]; platforms: string[]; note: string | null };

const PALETTE = ["#ff1eb4", "#579df8", "#2fd4a0", "#f5b83d", "#be6aff", "#ff7b71", "#1fc8c8", "#8fd14f"];

/** 新建 / 编辑竞品。保存成功后回调 onSaved。 */
export function CompetitorModal({ initial, onClose, onSaved }: { initial?: CompetitorInput; onClose: () => void; onSaved: (id: number) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? PALETTE[0]);
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join("\n"));
  const [platforms, setPlatforms] = useState<string[]>(initial?.platforms ?? ["douyin"]);
  const [note, setNote] = useState(initial?.note ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const kws = keywords.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean);

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const body = { name, color, keywords: kws, platforms, note: note || null };
      if (initial?.id) {
        await api(`/api/competitors/${initial.id}`, "PATCH", body);
        toast("竞品已更新");
        onSaved(initial.id);
      } else {
        const r = await api<{ id: number }>("/api/competitors", "POST", body);
        toast("竞品已创建");
        onSaved(r.id);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={initial?.id ? "编辑竞品" : "新建竞品"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn" onClick={save} disabled={busy || !name.trim() || !kws.length || !platforms.length}>{busy ? "保存中…" : "保存"}</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cm-name">竞品名称</label>
        <input id="cm-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：LibTV" autoFocus />
      </div>
      <div className="field">
        <span className="label">标识颜色</span>
        <div className="chips" role="radiogroup" aria-label="标识颜色">
          {PALETTE.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
              style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: color === c ? "2px solid var(--text)" : "2px solid transparent", outline: color === c ? "2px solid var(--surface)" : "none", outlineOffset: -4, cursor: "pointer" }} />
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="cm-kw">监测关键词</label>
        <textarea id="cm-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"品牌词、产品词、功能词\n每行一个，或用逗号分隔"} />
        <span className="hint">命中任意关键词的作品会被纳入判定（中英文混写会自动拆词匹配）</span>
      </div>
      <div className="field">
        <span className="label">监测平台</span>
        <div className="chips">
          {PLATFORM_LIST.map((p) => (
            <button key={p.id} type="button" className={`chip ${platforms.includes(p.id) ? "on" : ""}`}
              onClick={() => setPlatforms(platforms.includes(p.id) ? platforms.filter((x) => x !== p.id) : [...platforms, p.id])}>{p.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="cm-note">备注（可选）</label>
        <textarea id="cm-note" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 56 }} />
      </div>
      {err && <div className="alert">{err}</div>}
    </Modal>
  );
}
