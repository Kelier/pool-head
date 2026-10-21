"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountDrawer } from "@/components/AccountDrawer";
import { AccountTable, type SortState } from "@/components/AccountTable";
import { Donut, LineChart } from "@/components/charts";
import { ExportMenu } from "@/components/ExportMenu";
import { Badge, Empty, Icon, Kpi, Modal, PageHead, Pager, Seg, Skeleton, StatusBadge, Swatch } from "@/components/ui";
import { PLATFORM_LIST, PLATFORM_NAME, SOURCE_LABEL, TIER_COLOR, TIER_LABEL } from "@/lib/consts";
import { fmtDateTime, fmtNum, qs } from "@/lib/format";
import type { AccountRow } from "@/lib/queries";
import { api, toast, useApi } from "@/lib/useApi";
import { durationText, isLive, platformText, rangeText, taskTitle, type TaskT } from "../_parts";

type Summary = { accounts: number; repeat: number; posts: number; newThisWeek: number; repeatRate: number; tiers: Record<string, number> };
type Resp = {
  task: TaskT; summary: Summary; trend: { weeks: number[]; series: Record<string, number[]> };
  total: number; rows: AccountRow[]; page: number; pageSize: number;
};

const PROBLEM: Record<string, string> = {
  failed: "任务执行失败", paused_budget: "已达今日 API 调用预算，任务已暂停", paused_circuit: "TikHub 连续失败，已触发熔断保护",
  interrupted: "服务重启导致任务中断", cancelled: "任务已被取消",
};

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [platform, setPlatform] = useState("");
  const [tier, setTier] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState>({ sort: "count", dir: "desc" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ platform: string; uid: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const filter = { repeat: repeatOnly, platform, tier, q };
  const { data, error, reload } = useApi<Resp>(
    `/api/tasks/${id}${qs({ ...filter, sort: sort.sort, dir: sort.dir, page, pageSize: 20 })}`,
    (d) => (d && isLive(d.task.status) ? 2500 : false),
  );

  const onSort = (key: string) => {
    setSort((s) => (s.sort === key ? { sort: key, dir: s.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" }));
    setPage(1);
  };

  async function act(action: "rerun" | "cancel") {
    setBusy(true);
    try {
      const r = await api<{ id?: number }>(`/api/tasks/${id}/action`, "POST", { action });
      if (action === "rerun" && r.id) {
        toast(`已创建重跑任务 #${r.id}`);
        router.push(`/tasks/${r.id}`);
      } else {
        toast("已请求取消");
        await reload();
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api(`/api/tasks/${id}`, "DELETE");
      toast("任务已删除");
      router.push("/tasks");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  if (error && !data) {
    return (
      <>
        <PageHead title="任务详情" crumb={<Link href="/tasks">监测任务</Link>} />
        <div className="card"><Empty title="找不到该任务" action={<Link className="btn" href="/tasks">返回任务列表</Link>}>{error}</Empty></div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHead title="任务详情" crumb={<Link href="/tasks">监测任务</Link>} />
        <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}><Skeleton h={90} /><Skeleton h={120} /><Skeleton h={320} /></div>
      </>
    );
  }

  const { task, summary, trend } = data;
  const live = isLive(task.status);
  const p = task.progress;
  const cfg = task.config;
  const trendData = trend.weeks.map((_, i) => Object.values(trend.series).reduce((a, s) => a + (s[i] ?? 0), 0));
  const filtered = !!(repeatOnly || platform || tier || q);
  const steps: Array<[string, string]> = [["searching", "搜索内容"], ["enriching", "补全账号"], ["done", "完成"]];
  const stepIdx = task.status === "done" ? 2 : Math.max(0, steps.findIndex(([k]) => k === p.stage));
  const exportQuery = qs({ task: task.id, ...filter, sort: sort.sort, dir: sort.dir }).slice(1);

  return (
    <>
      <PageHead
        crumb={<><Link href="/tasks">监测任务</Link> / #{task.id}</>}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {task.competitorColor && <Swatch color={task.competitorColor} />}{taskTitle(task)}<StatusBadge status={task.status} />
          </span>
        }
        sub={<>{SOURCE_LABEL[task.source] ?? task.source}任务 · 创建于 {fmtDateTime(task.createdAt)} · 耗时 {durationText(task)}{task.competitorId && <> · <Link href={`/competitors/${task.competitorId}`}>查看竞品「{task.competitorName}」</Link></>}</>}
        actions={
          <>
            {live
              ? <button className="btn ghost" disabled={busy} onClick={() => act("cancel")}>取消任务</button>
              : <button className="btn ghost" disabled={busy} onClick={() => act("rerun")}><Icon name="refresh" />重跑</button>}
            <ExportMenu query={exportQuery} />
            <button className="btn danger" onClick={() => setConfirmDel(true)}><Icon name="trash" />删除</button>
          </>
        }
      />

      <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        {PROBLEM[task.status] && task.status !== "cancelled" && (
          <div className="alert" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span><b>{PROBLEM[task.status]}</b>{task.error && `：${task.error}`}。已抓到的数据仍可查看，调整后可重跑（1 小时内的请求会命中缓存，不重复计费）。</span>
            <button className="btn sm" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => act("rerun")}>重跑任务</button>
          </div>
        )}
        {task.status === "cancelled" && <div className="notice">任务已取消，以下为取消前已入库的数据。</div>}

        <div className="grid cols-3" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
          <section className="card pad">
            <h2>任务配置</h2>
            <dl className="kv">
              <dt>平台</dt><dd>{platformText(cfg)}</dd>
              <dt>关键词</dt><dd>{cfg.keywords.map((k) => <span className="tag" key={k}>{k}</span>)}<span className="faint">（{cfg.match === "all" ? "包含全部" : "包含任意"}）</span></dd>
              <dt>时间范围</dt><dd>{rangeText(cfg)}</dd>
              <dt>过滤条件</dt>
              <dd>
                {!cfg.followers && !cfg.engagement ? <span className="faint">无</span> : (
                  <>
                    {cfg.followers && <span className="tag">粉丝 {cfg.followers.min != null ? fmtNum(cfg.followers.min) : "不限"} ~ {cfg.followers.max != null ? fmtNum(cfg.followers.max) : "不限"}</span>}
                    {cfg.engagement?.minLikes != null && <span className="tag">点赞 ≥ {cfg.engagement.minLikes}</span>}
                    {cfg.engagement?.minComments != null && <span className="tag">评论 ≥ {cfg.engagement.minComments}</span>}
                  </>
                )}
              </dd>
              <dt>判定口径</dt><dd>复投阈值 ≥ {cfg.repeatThreshold} 次 · 最低置信度 {cfg.minConfidence} · 每词最多 {cfg.maxPages} 页</dd>
            </dl>
          </section>

          <section className="card pad">
            <h2>执行进度</h2>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {steps.map(([k, l], i) => (
                <div key={k} style={{ flex: 1 }}>
                  <div className={`bar ${i < stepIdx || task.status === "done" ? "" : ""}`} style={{ opacity: i <= stepIdx ? 1 : 0.35 }}><i style={{ width: i < stepIdx || task.status === "done" ? "100%" : i === stepIdx && live ? "55%" : i === stepIdx ? "100%" : "0%" }} /></div>
                  <div className="hint" style={{ marginTop: 4, fontWeight: i === stepIdx ? 600 : 400, color: i === stepIdx ? "var(--text)" : undefined }}>{l}</div>
                </div>
              ))}
            </div>
            <dl className="kv" style={{ gridTemplateColumns: "88px 1fr" }}>
              <dt>API 调用</dt><dd className="num">{p.calls ?? 0} 次</dd>
              <dt>浏览内容</dt><dd className="num">{p.postsSeen ?? 0} 条</dd>
              <dt>命中作品</dt><dd className="num">{p.postsMatched ?? 0} 条</dd>
              {task.finishedAt && <><dt>完成于</dt><dd>{fmtDateTime(task.finishedAt)}</dd></>}
            </dl>
          </section>
        </div>

        <div className="grid cols-4" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}>
          <Kpi label="浏览内容" value={fmtNum(p.postsSeen ?? 0)} sub="搜索返回的全部内容" icon="search" />
          <Kpi label="命中作品" value={fmtNum(summary.posts)} sub="已扣除人工否决" icon="file" />
          <Kpi label="投放账号" value={fmtNum(summary.accounts)} icon="users" />
          <Kpi label="新增账号" value={p.newAccounts ?? "—"} sub="相对该竞品历史" icon="plus" />
          <Kpi label="高频复投账号" value={fmtNum(summary.repeat)} hot={summary.repeat > 0} sub={`占 ${(summary.repeatRate * 100).toFixed(0)}% · ≥${cfg.repeatThreshold} 次`} icon="flame" />
        </div>

        {summary.posts > 0 && (
          <div className="grid cols-2-1" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)" }}>
            <section className="card pad">
              <h2>近 12 周投放趋势（按作品发布时间）</h2>
              <div style={{ maxWidth: 560 }}>
                <LineChart weeks={trend.weeks} series={[{ name: "投放内容量", color: "var(--accent)", data: trendData }]} height={200} />
              </div>
            </section>
            <section className="card pad">
              <h2>账号层级分布</h2>
              <Donut
                center={{ v: String(summary.accounts), l: "账号" }}
                items={Object.entries(TIER_LABEL).map(([k, l]) => ({ label: l, value: summary.tiers[k] ?? 0, color: TIER_COLOR[k] })).filter((i) => i.value > 0)}
              />
            </section>
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <h2>投放账号（{data.total}）</h2>
            <Seg value={repeatOnly ? "repeat" : "all"} onChange={(v) => { setRepeatOnly(v === "repeat"); setPage(1); }} options={[["all", "全部账号"], ["repeat", "高频复投"]]} />
          </div>
          <div className="toolbar">
            <div className="search grow">
              <Icon name="search" />
              <input type="search" placeholder="搜索账号名 / UID / 备注" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="搜索账号" />
            </div>
            <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }} aria-label="平台">
              <option value="">全部平台</option>
              {PLATFORM_LIST.filter((x) => cfg.platforms.includes(x.id as never)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} aria-label="层级">
              <option value="">全部层级</option>
              {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {filtered && <button className="btn ghost sm" onClick={() => { setRepeatOnly(false); setPlatform(""); setTier(""); setQInput(""); }}>清除筛选</button>}
            <Badge kind="info">{PLATFORM_NAME[cfg.platforms[0]]}{cfg.platforms.length > 1 ? ` 等 ${cfg.platforms.length} 个平台` : ""}</Badge>
          </div>
          {data.rows.length === 0 ? (
            <Empty title={live ? "正在抓取，结果会陆续出现" : filtered ? "没有符合条件的账号" : "该任务没有命中任何账号"}>
              {live ? "页面每 2.5 秒自动刷新" : filtered ? "试试清除筛选" : "可以放宽关键词、时间范围或降低过滤门槛后重跑"}
            </Empty>
          ) : (
            <AccountTable rows={data.rows} onOpen={(a) => setOpen({ platform: a.platform, uid: a.uid })} sort={sort} onSort={onSort} showCompetitors={false} />
          )}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </section>
      </div>

      {open && <AccountDrawer platform={open.platform} uid={open.uid} onClose={() => setOpen(null)} onChanged={reload} />}
      {confirmDel && (
        <Modal
          title="删除任务"
          onClose={() => setConfirmDel(false)}
          footer={<><button className="btn ghost" onClick={() => setConfirmDel(false)}>取消</button><button className="btn danger" onClick={remove}>确认删除</button></>}
        >
          <p style={{ margin: 0 }}>将删除 <b>{taskTitle(task)}</b>（#{task.id}）的作品快照与调用日志，<b>不可恢复</b>。</p>
        </Modal>
      )}
    </>
  );
}
