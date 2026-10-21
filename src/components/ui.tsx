"use client";
import { useEffect, type ReactNode } from "react";
import { TASK_STATUS, TIER_LABEL, ACCOUNT_STATUS } from "@/lib/consts";

export type IconName =
  | "home" | "target" | "list" | "users" | "compare" | "bell" | "settings" | "search" | "download" | "plus" | "play"
  | "refresh" | "trash" | "flame" | "clock" | "chart" | "x" | "external" | "file" | "help";

const P: Record<IconName, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  users: "M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a4 4 0 100-8 4 4 0 000 8zM21 20v-2a4 4 0 00-3-3.87M16 2.13a4 4 0 010 7.75",
  compare: "M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7",
  bell: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  plus: "M12 5v14M5 12h14",
  play: "M6 4l14 8-14 8V4z",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
  trash: "M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6",
  flame: "M12 2s5 4 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8zM9 18a3 3 0 006 0",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  chart: "M3 3v18h18M7 14l4-4 3 3 5-6",
  x: "M18 6L6 18M6 6l12 12",
  external: "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4M12 17h.01",
  file: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8",
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name]} />
    </svg>
  );
}

export function PageHead({ title, sub, crumb, actions }: { title: ReactNode; sub?: ReactNode; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions no-print">{actions}</div>}
    </header>
  );
}

export function Kpi({ label, value, sub, hot, icon }: { label: string; value: ReactNode; sub?: ReactNode; hot?: boolean; icon?: IconName }) {
  return (
    <div className="card kpi">
      <div className="l">{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className={`v ${hot ? "hot" : ""}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Badge({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={`badge ${kind ?? ""}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const live = status === "running" || status === "pending";
  return <span className={`badge ${status}`}>{live && <i className="dot" />}{TASK_STATUS[status] ?? status}</span>;
}

const TIER_KIND: Record<string, string> = { head: "hot", waist: "warn", tail: "ok", micro: "accent", unknown: "" };
export const TierBadge = ({ tier }: { tier: string }) => <Badge kind={TIER_KIND[tier]}>{TIER_LABEL[tier] ?? tier}</Badge>;
export const AccountStatusBadge = ({ status }: { status: string }) =>
  status === "none" ? null : <Badge kind={status === "excluded" ? "cancelled" : status === "watch" ? "warn" : "info"}>{ACCOUNT_STATUS[status] ?? status}</Badge>;

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="pager"><span>共 {total} 条</span></div>;
  return (
    <div className="pager">
      <span>共 {total} 条 · 第 {page}/{pages} 页</span>
      <span className="pg">
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
        <button className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
      </span>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="foot">{footer}</div>}
      </div>
    </>
  );
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>{title}</div>
          <button className="x" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Swatch({ color }: { color: string }) {
  return <i className="swatch" style={{ background: color }} />;
}

export function CompetitorTags({ items }: { items: Array<{ id: number; name: string; color: string; count?: number }> }) {
  if (!items.length) return <span className="faint">—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((c) => (
        <span key={c.id} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Swatch color={c.color} />{c.name}{c.count != null && <b className="num">×{c.count}</b>}
        </span>
      ))}
    </span>
  );
}
