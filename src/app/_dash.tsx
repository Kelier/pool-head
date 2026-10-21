"use client";
// 总览 / 竞品 / 报告 三类页面共用的小部件（页面私有，不属于共享设计系统）
import { useEffect, useState } from "react";
import type { AccountRow } from "@/lib/queries";
import { PLATFORM_NAME, TIER_COLOR, TIER_LABEL } from "@/lib/consts";
import { fmtNum } from "@/lib/format";
import { Badge, Empty, TierBadge } from "@/components/ui";
import { Donut, HBars } from "@/components/charts";

export type Summary = {
  accounts: number; repeat: number; posts: number; newThisWeek: number; repeatRate: number;
  tiers: Record<string, number>; platforms: Record<string, number>;
};

export type ScheduleRow = { id: number; competitor_id: number; interval_days: number; window_days: number; max_pages: number; enabled: number; next_run_at: number; last_run_at: number | null };

const TIER_ORDER = ["head", "waist", "tail", "micro", "unknown"];

export function TierDonut({ tiers, total }: { tiers: Record<string, number>; total: number }) {
  const items = TIER_ORDER.filter((t) => (tiers[t] ?? 0) > 0).map((t) => ({ label: TIER_LABEL[t], value: tiers[t], color: TIER_COLOR[t] }));
  if (!items.length) return <div className="faint" style={{ padding: "24px 0" }}>暂无数据</div>;
  return <Donut items={items} size={140} center={{ v: String(total), l: "账号" }} />;
}

export function PlatformBars({ platforms }: { platforms: Record<string, number> }) {
  const items = Object.entries(platforms).sort((a, b) => b[1] - a[1]).map(([p, v]) => ({ label: PLATFORM_NAME[p] ?? p, value: v }));
  if (!items.length) return <div className="faint">暂无数据</div>;
  return <HBars items={items} />;
}

/** 紧凑账号列表（总览用）：头像 / 名称 / 平台·粉丝 / 层级 / 次数。 */
export function AccountMiniList({ rows, onOpen, empty, metric = "count" }: { rows: AccountRow[]; onOpen: (a: AccountRow) => void; empty: string; metric?: "count" | "label" }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div>
      {rows.map((a) => (
        <button key={`${a.platform}:${a.uid}`} onClick={() => onOpen(a)} type="button"
          style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", width: "100%", textAlign: "left", background: "none", border: 0, borderBottom: "1px solid var(--line-2)", padding: "10px 20px", cursor: "pointer", color: "inherit" }}>
          <span className="who" style={{ minWidth: 0 }}>
            <span className="av">{(a.name || "?").slice(0, 1)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="n" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
              <span className="s">{PLATFORM_NAME[a.platform] ?? a.platform} · {fmtNum(a.followers)} 粉丝</span>
            </span>
          </span>
          <TierBadge tier={a.tier} />
          {metric === "count"
            ? <span className="count hot num" title="单竞品最高投放次数">{a.maxRepeat}<span className="faint" style={{ fontSize: 12, fontWeight: 400 }}> 次</span></span>
            : <Badge kind={a.isRepeat ? "hot" : ""}>{a.label}</Badge>}
        </button>
      ))}
    </div>
  );
}

export const SCHEDULE_OPTIONS = [1, 3, 7, 14, 30];

export function scheduleText(s: { interval_days: number; enabled: number } | null | undefined) {
  if (!s) return "未设置";
  return s.enabled ? `每 ${s.interval_days} 天` : "已暂停";
}

/**
 * /api/overview、/api/competitors 里每个竞品的 `platforms` 被统计摘要（各平台账号数）覆盖了，
 * 这里逐个读 /api/competitors/[id] 取竞品真实配置的平台列表。
 */
export function useCompetitorPlatforms(ids: number[]) {
  const [map, setMap] = useState<Record<number, string[]>>({});
  const key = ids.join(",");
  useEffect(() => {
    let dead = false;
    Promise.all(ids.map((id) => fetch(`/api/competitors/${id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => [id, j.competitor?.platforms ?? []] as const).catch(() => [id, []] as const)))
      .then((e) => !dead && setMap(Object.fromEntries(e)));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}
