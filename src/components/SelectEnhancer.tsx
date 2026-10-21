"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Opt = { value: string; label: string; disabled: boolean };
type MenuState = { el: HTMLSelectElement; rect: DOMRect; opts: Opt[] };

/**
 * 全局把原生 <select> 的系统弹层换成统一风格的菜单：不改任何页面代码。
 * 点击/回车/空格/方向键打开；选中后写回原生 select 并派发 change，React 受控组件照常工作。
 */
export function SelectEnhancer() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [act, setAct] = useState(0);
  const ref = useRef<MenuState | null>(null);
  const actRef = useRef(0);
  ref.current = menu;
  actRef.current = act;

  useEffect(() => {
    const open = (el: HTMLSelectElement) => {
      if (el.disabled || el.multiple) return;
      const opts = [...el.options].map((o) => ({ value: o.value, label: o.textContent ?? "", disabled: o.disabled }));
      setMenu({ el, rect: el.getBoundingClientRect(), opts });
      setAct(Math.max(0, el.selectedIndex));
    };
    const pick = (m: MenuState, i: number) => {
      const o = m.opts[i];
      if (!o || o.disabled) return;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      set.call(m.el, o.value);
      m.el.dispatchEvent(new Event("change", { bubbles: true }));
      setMenu(null);
      m.el.focus();
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const sel = t?.closest?.("select") as HTMLSelectElement | null;
      if (sel && !sel.multiple) {
        e.preventDefault();
        sel.focus();
        ref.current?.el === sel ? setMenu(null) : open(sel);
      } else if (!t?.closest?.(".menu")) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      const m = ref.current;
      if (m) {
        const n = m.opts.length;
        if (e.key === "Escape") { e.preventDefault(); setMenu(null); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => (a + 1) % n); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => (a - 1 + n) % n); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(m, actRef.current); }
        else if (e.key === "Tab") setMenu(null);
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLSelectElement && !el.multiple && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        open(el);
      }
    };
    const close = () => setMenu(null);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    document.querySelector(".menu-item.act")?.scrollIntoView({ block: "nearest" });
  }, [menu, act]);

  if (!menu) return null;
  const { rect, opts, el } = menu;
  const maxH = 320;
  const below = window.innerHeight - rect.bottom - 12;
  const up = below < Math.min(maxH, opts.length * 36 + 12) && rect.top > below;
  const style: React.CSSProperties = {
    left: Math.min(rect.left, window.innerWidth - 16 - Math.max(rect.width, 200)),
    minWidth: rect.width,
    maxWidth: Math.min(520, window.innerWidth - 32),
    maxHeight: Math.min(maxH, (up ? rect.top : below) - 4),
    ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  };
  return createPortal(
    <div className="menu" style={style} role="listbox">
      {opts.map((o, i) => (
        <div
          key={i}
          role="option"
          aria-selected={i === el.selectedIndex}
          className={`menu-item ${i === act ? "act" : ""} ${i === el.selectedIndex ? "sel" : ""} ${o.disabled ? "dis" : ""}`}
          onMouseEnter={() => setAct(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const m = ref.current;
            if (!m || o.disabled) return;
            const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
            set.call(m.el, o.value);
            m.el.dispatchEvent(new Event("change", { bubbles: true }));
            setMenu(null);
          }}
        >
          <span className="ck">{i === el.selectedIndex ? "✓" : ""}</span>
          <span className="tx">{o.label || "—"}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
