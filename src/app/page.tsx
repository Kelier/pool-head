"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AccountRow } from "@/lib/queries";
import { PLATFORM_NAME, SOURCE_LABEL } from "@/lib/consts";
import { fmtPct, relTime } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { Empty, Icon, Kpi, PageHead, Skeleton, StatusBadge, Swatch } from "@/components/ui";
import { LineChart, Sparkline } from "@/components/charts";
import { AccountDrawer } from "@/components/AccountDrawer";
import { NewTaskModal } from "@/components/NewTaskModal";
import { AccountMiniList, PlatformBars, TierDonut, scheduleText, useCompetitorPlatforms, type ScheduleRow, type Summary } from "./_dash";

type CompRow = Summary & {
  id: number; name: string; color: string; keywords: string[];
  lastTask: { id: number; status: string; finished_at: number | null } | null; schedule: ScheduleRow | null;
};
type TaskRow = { id: number; name: string | null; status: string; source: string; competitorName: string | null; competitorColor: string | null; createdAt: number; progress: { accounts?: number; newAccounts?: number }; config: { keywords: string[]; platforms: string[] } };
type Overview = {
  totals: Summary & { competitors: number; tasks: number };
  perCompetitor: CompRow[];
  trend: { weeks: number[]; series: Record<string, number[]>; competitors: Array<{ id: number; name: string; color: string; key: string }> };
  newAccounts: AccountRow[]; topRepeat: AccountRow[]; recentTasks: TaskRow[];
};

export default function OverviewPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<Overview>("/api/overview", (d) => (d?.recentTasks.some((t) => t.status === "running" || t.status === "pending") ? 4000 : 30_000));
  const [open, setOpen] = useState<{ platform: string; uid: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const plats = useCompetitorPlatforms(data?.perCompetitor.map((c) => c.id) ?? []);

  const actions = (
    <>
      <Link href="/competitors" className="btn ghost"><Icon name="target" />竞品管理</Link>
      <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" />新建抓取任务</button>
    </>
  );

  if (error && !data) return (<><PageHead title="总览" actions={actions} /><div className="alert">加载失败：{error}</div></>);
  if (!data) return (
    <>
      <PageHead title="总览" sub="竞品投放动态一览" />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="card kpi"><Skeleton h={12} w={80} /><div style={{ height: 10 }} /><Skeleton h={28} w={110} /></div>)}
      </div>
      <div className="grid cols-2-1" style={{ marginTop: 16 }}><div className="card pad"><Skeleton h={240} /></div><div className="card pad"><Skeleton h={240} /></div></div>
    </>
  );

  const t = data.totals;
  const empty = t.competitors === 0 && t.tasks === 0;
  const series = data.trend.competitors.map((c) => ({ name: c.name, color: c.color, data: data.trend.series[c.key] ?? new Array(data.trend.weeks.length).fill(0) }));
  // 无竞品归属的临时任务也有数据：汇总成一条"临时任务"序列
  const adhoc = Object.entries(data.trend.series).filter(([k]) => k.startsWith("t")).reduce<number[]>((acc, [, v]) => v.map((x, i) => (acc[i] ?? 0) + x), []);
  if (adhoc.length && adhoc.some(Boolean)) series.push({ name: "临时任务", color: "#94a3b8", data: adhoc });

  return (
    <>
      <PageHead title="总览" sub="竞品投放账号动态：谁在投、投了多少、哪些账号被反复投放" actions={actions} />

      {empty ? (
        <div className="card">
          <Empty title="还没有监测数据" action={<Link href="/competitors" className="btn"><Icon name="plus" />创建第一个竞品</Link>}>
            先添加要监测的竞品和关键词，系统会自动抓取其在各平台的投放账号，并识别被反复投放的核心 KOL。
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            <Kpi icon="target" label="监测竞品" value={t.competitors} sub={`${t.tasks} 次抓取任务`} />
            <Kpi icon="users" label="投放账号" value={t.accounts.toLocaleString()} sub={`覆盖 ${Object.keys(t.platforms).length} 个平台`} />
            <Kpi icon="flame" label="高频复投账号" value={t.repeat} hot={t.repeat > 0} sub={`复投率 ${fmtPct(t.repeatRate)}`} />
            <Kpi icon="plus" label="本周新增账号" value={t.newThisWeek} sub="近 7 天首次发现" />
            <Kpi icon="file" label="命中投放作品" value={t.posts.toLocaleString()} sub="已剔除人工标记的误判" />
          </div>

          <div className="grid cols-2-1">
            <div className="card pad">
              <h2>近 12 周投放趋势 <span className="faint" style={{ fontWeight: 400 }}>· 按作品发布时间，每周命中作品数</span></h2>
              {series.length ? <LineChart weeks={data.trend.weeks} series={series} height={300} /> : <div className="faint">暂无趋势数据</div>}
            </div>
            <div className="stack">
              <div className="card pad"><h2>账号层级分布</h2><TierDonut tiers={t.tiers} total={t.accounts} /></div>
              <div className="card pad"><h2>平台分布（账号数）</h2><PlatformBars platforms={t.platforms} /></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>各竞品对比</h2><Link href="/compare" className="btn ghost sm">竞品间对比 →</Link></div>
            {data.perCompetitor.length === 0 ? <Empty title="暂无竞品" /> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>竞品</th><th className="r">投放账号</th><th className="r">高频复投</th><th className="r">命中作品</th><th>近 12 周</th><th>最近抓取</th><th>定时监控</th></tr></thead>
                  <tbody>
                    {data.perCompetitor.map((c) => (
                      <tr key={c.id} className="row" onClick={() => router.push(`/competitors/${c.id}`)}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 150 }}>
                            <Swatch color={c.color} />
                            <div><div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.name}</div><div className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{(plats[c.id] ?? []).map((p) => PLATFORM_NAME[p] ?? p).join(" · ") || "\u00a0"}</div></div>
                          </div>
                        </td>
                        <td className="r num">{c.accounts}</td>
                        <td className="r num"><b style={{ color: c.repeat ? "var(--hot)" : undefined }}>{c.repeat}</b> <span className="faint">({fmtPct(c.repeatRate)})</span></td>
                        <td className="r num">{c.posts}</td>
                        <td><Sparkline data={data.trend.series[`c${c.id}`] ?? new Array(12).fill(0)} color={c.color} /></td>
                        <td>{c.lastTask ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><StatusBadge status={c.lastTask.status} /><span className="faint">{relTime(c.lastTask.finished_at)}</span></span> : <span className="faint">从未抓取</span>}</td>
                        <td className="muted">{scheduleText(c.schedule)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid cols-2">
            <div className="card">
              <div className="card-head"><h2>本周新增账号</h2><Link href="/accounts?sort=seen" className="btn ghost sm">全部 →</Link></div>
              <AccountMiniList rows={data.newAccounts} onOpen={(a) => setOpen(a)} metric="label" empty="本周暂无新增账号" />
            </div>
            <div className="card">
              <div className="card-head"><h2>高频复投 Top</h2><Link href="/accounts?repeat=1" className="btn ghost sm">全部 →</Link></div>
              <AccountMiniList rows={data.topRepeat} onOpen={(a) => setOpen(a)} empty="暂无达到复投阈值的账号" />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>最近任务</h2><Link href="/tasks" className="btn ghost sm">全部任务 →</Link></div>
            {data.recentTasks.length === 0 ? <Empty title="还没有任务" /> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>任务</th><th>来源</th><th>状态</th><th className="r">命中账号</th><th className="r">新增</th><th>创建时间</th></tr></thead>
                  <tbody>
                    {data.recentTasks.map((k) => (
                      <tr key={k.id} className="row" onClick={() => router.push(`/tasks/${k.id}`)}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {k.competitorColor && <Swatch color={k.competitorColor} />}
                            <b>#{k.id}</b> {k.name ?? k.config.keywords.join("、")}
                          </div>
                        </td>
                        <td className="muted">{SOURCE_LABEL[k.source] ?? k.source}</td>
                        <td><StatusBadge status={k.status} /></td>
                        <td className="r num">{k.progress.accounts ?? "—"}</td>
                        <td className="r num">{k.progress.newAccounts ?? "—"}</td>
                        <td className="muted">{relTime(k.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {open && <AccountDrawer platform={open.platform} uid={open.uid} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && <NewTaskModal onClose={() => setCreating(false)} onCreated={(id) => router.push(`/tasks/${id}`)} />}
    </>
  );
}
