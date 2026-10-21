"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { AccountRow } from "@/lib/queries";
import { PLATFORM_LIST, PLATFORM_NAME, SOURCE_LABEL, TIER_LABEL } from "@/lib/consts";
import { fmtDateTime, fmtPct, qs, relTime } from "@/lib/format";
import { api, toast, useApi } from "@/lib/useApi";
import { Badge, Empty, Icon, Kpi, PageHead, Pager, Seg, Skeleton, StatusBadge, Swatch } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { AccountTable, type SortState } from "@/components/AccountTable";
import { AccountDrawer } from "@/components/AccountDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { NewTaskModal } from "@/components/NewTaskModal";
import { PlatformBars, SCHEDULE_OPTIONS, TierDonut, type ScheduleRow, type Summary } from "../../_dash";
import { CompetitorModal } from "../_parts";

type TaskRow = { id: number; name: string | null; status: string; source: string; createdAt: number; progress: { accounts?: number; newAccounts?: number; newRepeat?: number } };
type Detail = {
  competitor: { id: number; name: string; color: string; keywords: string[]; platforms: string[]; note: string | null };
  summary: Summary;
  trend: { weeks: number[]; series: Record<string, number[]> };
  tasks: TaskRow[];
  schedule: ScheduleRow | null;
};
type AccountsResp = { total: number; rows: AccountRow[]; page: number; pageSize: number };

const PAGE_SIZE = 20;

export default function CompetitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const detail = useApi<Detail>(`/api/competitors/${id}`, (d) => (d?.tasks.some((t) => t.status === "running" || t.status === "pending") ? 4000 : false));

  const [repeatOnly, setRepeatOnly] = useState(false);
  const [platform, setPlatform] = useState("");
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState>({ sort: "count", dir: "desc" });
  const [page, setPage] = useState(1);
  const filterQuery = { competitorScope: id, repeat: repeatOnly, platform, tier, q };
  const accounts = useApi<AccountsResp>(`/api/accounts${qs({ ...filterQuery, sort: sort.sort, dir: sort.dir, page, pageSize: PAGE_SIZE })}`);

  const [open, setOpen] = useState<{ platform: string; uid: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);

  const refreshAll = () => { detail.reload(); accounts.reload(); };
  const onSort = (key: string) => { setPage(1); setSort((s) => (s.sort === key ? { sort: key, dir: s.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" })); };

  if (detail.error && !detail.data) {
    return <><PageHead title="竞品详情" crumb={<Link href="/competitors">竞品管理</Link>} /><div className="alert">加载失败：{detail.error}</div></>;
  }
  if (!detail.data) {
    return (
      <>
        <PageHead title="加载中…" crumb={<Link href="/competitors">竞品管理</Link>} />
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>{[0, 1, 2, 3].map((i) => <div key={i} className="card kpi"><Skeleton h={12} w={80} /><div style={{ height: 10 }} /><Skeleton h={28} w={100} /></div>)}</div>
      </>
    );
  }

  const { competitor: c, summary: s, trend, tasks, schedule } = detail.data;
  const key = `c${c.id}`;
  const lastTask = tasks[0];

  return (
    <>
      <PageHead
        crumb={<><Link href="/competitors">竞品管理</Link> / {c.name}</>}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><Swatch color={c.color} />{c.name}</span>}
        sub={
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {c.platforms.map((p) => <Badge key={p} kind="accent">{PLATFORM_NAME[p] ?? p}</Badge>)}
            {c.keywords.map((k) => <span key={k} className="tag" style={{ margin: 0 }}>{k}</span>)}
            {c.note && <span className="faint">· {c.note}</span>}
          </span>
        }
        actions={
          <>
            <button className="btn" onClick={() => setRunning(true)}><Icon name="play" size={14} />立即抓取</button>
            <ExportMenu query={`competitorScope=${c.id}`} />
            <Link href={`/reports/${c.id}`} className="btn ghost" target="_blank"><Icon name="file" />监测报告</Link>
            <button className="btn ghost" onClick={() => setEditing(true)}>编辑</button>
          </>
        }
      />

      <div className="stack">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Kpi icon="users" label="投放账号" value={s.accounts} sub={`${Object.keys(s.platforms).length} 个平台`} />
          <Kpi icon="flame" label="高频复投账号" value={s.repeat} hot={s.repeat > 0} sub={`复投率 ${fmtPct(s.repeatRate)}`} />
          <Kpi icon="file" label="命中投放作品" value={s.posts} sub={s.accounts ? `人均 ${(s.posts / s.accounts).toFixed(1)} 条` : undefined} />
          <Kpi icon="plus" label="本周新增账号" value={s.newThisWeek} sub="近 7 天首次发现" />
          <Kpi icon="clock" label="最近抓取" value={lastTask ? relTime(lastTask.createdAt) : "—"} sub={lastTask ? <StatusBadge status={lastTask.status} /> : "从未抓取"} />
        </div>

        <div className="grid cols-2-1">
          <div className="card pad">
            <h2>近 12 周投放趋势 <span className="faint" style={{ fontWeight: 400 }}>· 每周命中作品数</span></h2>
            <LineChart weeks={trend.weeks} series={[{ name: c.name, color: c.color, data: trend.series[key] ?? new Array(trend.weeks.length).fill(0) }]} height={340} />
          </div>
          <div className="stack">
            <div className="card pad"><h2>账号层级分布</h2><TierDonut tiers={s.tiers} total={s.accounts} /></div>
            <ScheduleCard competitorId={c.id} schedule={schedule} onChanged={detail.reload} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>投放账号库</h2>
            <span className="faint num">{accounts.data ? `${accounts.data.total} 个账号` : ""}</span>
          </div>
          <div className="toolbar">
            <Seg value={repeatOnly ? "repeat" : "all"} onChange={(v) => { setRepeatOnly(v === "repeat"); setPage(1); }} options={[["all", "全部账号"], ["repeat", "高频复投"]]} />
            <select aria-label="平台" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
              <option value="">全部平台</option>
              {PLATFORM_LIST.filter((p) => c.platforms.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select aria-label="层级" value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }}>
              <option value="">全部层级</option>
              {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="search grow">
              <Icon name="search" />
              <input type="search" placeholder="搜索账号名称 / 备注" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
          </div>
          {accounts.error && !accounts.data ? <div className="alert" style={{ margin: 16 }}>{accounts.error}</div>
            : !accounts.data ? <div style={{ padding: 20 }}><Skeleton h={200} /></div>
            : accounts.data.rows.length === 0 ? <Empty title={repeatOnly || platform || tier || q ? "没有符合条件的账号" : "还没有抓取到账号"}>{!lastTask && "点击右上角「立即抓取」开始第一次监测。"}</Empty>
            : (
              <>
                <AccountTable rows={accounts.data.rows} sort={sort} onSort={onSort} showCompetitors={false} onOpen={(a) => setOpen(a)} />
                <Pager page={accounts.data.page} pageSize={accounts.data.pageSize} total={accounts.data.total} onPage={setPage} />
              </>
            )}
        </div>

        <div className="grid cols-2-1">
          <div className="card">
            <div className="card-head"><h2>任务历史</h2><Link href={`/tasks?competitor=${c.id}`} className="btn ghost sm">全部 →</Link></div>
            {tasks.length === 0 ? <Empty title="还没有任务" /> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>任务</th><th>来源</th><th>状态</th><th className="r">命中账号</th><th className="r">新增</th><th className="r">新晋复投</th><th>创建时间</th></tr></thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id} className="row" onClick={() => router.push(`/tasks/${t.id}`)}>
                        <td><b>#{t.id}</b></td>
                        <td className="muted">{SOURCE_LABEL[t.source] ?? t.source}</td>
                        <td><StatusBadge status={t.status} /></td>
                        <td className="r num">{t.progress.accounts ?? "—"}</td>
                        <td className="r num">{t.progress.newAccounts ?? "—"}</td>
                        <td className="r num">{t.progress.newRepeat ?? "—"}</td>
                        <td className="muted nowrap">{fmtDateTime(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card pad"><h2>平台分布（账号数）</h2><PlatformBars platforms={s.platforms} /></div>
        </div>
      </div>

      {open && <AccountDrawer platform={open.platform} uid={open.uid} onClose={() => setOpen(null)} onChanged={refreshAll} />}
      {editing && <CompetitorModal initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refreshAll(); }} />}
      {running && <NewTaskModal preset={{ competitorId: c.id, name: c.name, keywords: c.keywords, platforms: c.platforms }} onClose={() => setRunning(false)} onCreated={(tid) => router.push(`/tasks/${tid}`)} />}
    </>
  );
}

/** 定时监控：每个竞品一个计划。保存即覆盖；进程内调度，服务需保持运行。 */
function ScheduleCard({ competitorId, schedule, onChanged }: { competitorId: number; schedule: ScheduleRow | null; onChanged: () => void }) {
  const [interval, setIntervalDays] = useState(schedule?.interval_days ?? 7);
  const [windowDays, setWindowDays] = useState(schedule?.window_days ?? 30);
  const [maxPages, setMaxPages] = useState(schedule?.max_pages ?? 3);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast(ok); setEditing(false); onChanged(); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  }
  const save = () => run(() => api("/api/schedules", "POST", { competitorId, intervalDays: interval, windowDays, maxPages }), "定时监控已开启");

  const form = (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="row2">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>每隔</label>
          <select value={interval} onChange={(e) => setIntervalDays(+e.target.value)}>{SCHEDULE_OPTIONS.map((d) => <option key={d} value={d}>{d} 天</option>)}</select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>抓取近</label>
          <select value={windowDays} onChange={(e) => setWindowDays(+e.target.value)}>{[7, 30, 90, 180].map((d) => <option key={d} value={d}>{d === 180 ? "半年" : `${d} 天`}</option>)}</select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>每个关键词翻页数（影响 API 调用量）</label>
        <input type="number" min={1} max={10} value={maxPages} onChange={(e) => setMaxPages(Math.min(10, Math.max(1, +e.target.value || 1)))} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn sm" disabled={busy} onClick={save}>{schedule ? "保存修改" : "开启定时监控"}</button>
        {(schedule || editing) && <button className="btn ghost sm" onClick={() => setEditing(false)}>取消</button>}
      </div>
    </div>
  );

  return (
    <div className="card pad">
      <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        定时监控 {schedule && <Badge kind={schedule.enabled ? "ok" : "warn"}>{schedule.enabled ? "运行中" : "已暂停"}</Badge>}
      </h2>
      {!schedule && !editing && (
        <>
          <p className="muted" style={{ margin: "0 0 12px" }}>按固定周期自动重新抓取，并在出现新增账号、新晋复投时提醒你。</p>
          {form}
        </>
      )}
      {schedule && !editing && (
        <>
          <dl className="kv" style={{ margin: "0 0 14px" }}>
            <dt>周期</dt><dd>每 {schedule.interval_days} 天 · 抓取近 {schedule.window_days} 天</dd>
            <dt>下次运行</dt><dd className="num">{schedule.enabled ? fmtDateTime(schedule.next_run_at) : "—（已暂停）"}</dd>
            <dt>上次运行</dt><dd className="num">{schedule.last_run_at ? fmtDateTime(schedule.last_run_at) : "尚未运行"}</dd>
          </dl>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api(`/api/schedules/${schedule.id}`, "PATCH", { enabled: !schedule.enabled }), schedule.enabled ? "已暂停" : "已恢复")}>{schedule.enabled ? "暂停" : "恢复"}</button>
            <button className="btn ghost sm" onClick={() => setEditing(true)}>修改</button>
            <button className="btn danger sm" disabled={busy} onClick={() => run(() => api(`/api/schedules/${schedule.id}`, "DELETE"), "已删除定时计划")}>删除</button>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>调度在服务进程内运行，需保持服务开启；预算用完时会跳过并提醒。</div>
        </>
      )}
      {editing && form}
    </div>
  );
}
