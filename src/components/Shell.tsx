"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./ui";
import { Logo } from "./Logo";
import { SelectEnhancer } from "./SelectEnhancer";
import { useApi } from "@/lib/useApi";

// 主导航按工作流排序：看全局 → 管竞品 → 跑任务 → 查账号 → 做对比
const NAV: Array<{ href: string; name: string; icon: IconName }> = [
  { href: "/", name: "总览", icon: "home" },
  { href: "/competitors", name: "竞品", icon: "target" },
  { href: "/tasks", name: "任务", icon: "list" },
  { href: "/accounts", name: "账号库", icon: "users" },
  { href: "/compare", name: "对比", icon: "compare" },
];

// 辅助入口收进底部图标行
const UTIL: Array<{ href: string; name: string; icon: IconName }> = [
  { href: "/alerts", name: "提醒", icon: "bell" },
  { href: "/settings", name: "设置", icon: "settings" },
  { href: "/help", name: "使用说明", icon: "help" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const alerts = useApi<{ unread: number }>("/api/alerts", () => 20_000);
  const tasks = useApi<{ budget: { used: number; limit: number } }>("/api/tasks?pageSize=1", () => 20_000);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: string }>>([]);

  useEffect(() => {
    let n = 0;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; kind: string };
      const id = ++n;
      setToasts((t) => [...t, { id, ...d }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };
    window.addEventListener("app-toast", h);
    return () => window.removeEventListener("app-toast", h);
  }, []);

  const b = tasks.data?.budget;
  const pct = b ? Math.min(100, (b.used / b.limit) * 100) : 0;
  const unread = alerts.data?.unread ?? 0;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="app">
      <aside className="side">
        <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
          <Logo size={30} />
          <span>投放监测</span>
        </Link>
        <nav className="nav">
          {NAV.map((it) => (
            <Link key={it.href} href={it.href} className={active(it.href) ? "on" : ""}>
              <Icon name={it.icon} size={17} />
              {it.name}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          {b && (
            <div className="meter" title="TikHub 今日已发出的真实调用数（不含缓存命中）">
              <div className="row"><span>今日 API 调用</span><span className="num">{b.used} / {b.limit}</span></div>
              <div className={`bar ${pct > 90 ? "hot" : pct > 70 ? "warn" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          <div className="util">
            {UTIL.map((it) => (
              <Link key={it.href} href={it.href} className={active(it.href) ? "on" : ""} title={it.name} aria-label={it.name}>
                <Icon name={it.icon} size={18} />
                {it.href === "/alerts" && unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
              </Link>
            ))}
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
      <SelectEnhancer />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
