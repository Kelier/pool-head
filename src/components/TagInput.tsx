"use client";
import { useRef, useState } from "react";
import s from "./TagInput.module.css";

const SPLIT = /[,，、;；\n\t]+/;

/** 标签输入：回车 / 逗号 / 中文逗号添加，退格删除末尾，粘贴多词自动拆分并去重。 */
export function TagInput({
  value, onChange, placeholder, label, max,
}: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; label?: string; max?: number;
}) {
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  function add(raw: string) {
    const parts = raw.split(SPLIT).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) {
      if (seen.has(p.toLowerCase()) || (max && next.length >= max)) continue;
      seen.add(p.toLowerCase());
      next.push(p);
    }
    if (next.length !== value.length) onChange(next);
  }

  return (
    <div className={s.box} onClick={() => ref.current?.focus()} role="group" aria-label={label}>
      {value.map((t, i) => (
        <span key={t} className={s.tag}>
          <span title={t}>{t}</span>
          <button type="button" className={s.x} aria-label={`删除 ${t}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)); }}>×</button>
        </span>
      ))}
      <input
        ref={ref}
        className={s.input}
        type="text"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        aria-label={label ?? "添加标签"}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,，、;；]/.test(v)) { add(v); setDraft(""); } else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(draft); setDraft(""); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (SPLIT.test(t)) { e.preventDefault(); add(draft + t); setDraft(""); }
        }}
        onBlur={() => { if (draft.trim()) { add(draft); setDraft(""); } }}
      />
    </div>
  );
}
