"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Empty, Icon, Modal, PageHead, Pager, Skeleton, StatusBadge, Swatch } from "@/components/ui";
import { NewTaskModal } from "@/components/NewTaskModal";
import { SOURCE_LABEL, TASK_STATUS } from "@/lib/consts";
import { fmtDateTime, qs } from "@/lib/format";
import { api, toast, useApi } from "@/lib/useApi";
import { durationText, isLive, platformText, rangeText, taskTitle, type CompetitorLite, type TaskT, type TasksResp } from "./_parts";

const PAGE_SIZE = 15;

export default function TasksPage() {
  const router = useRouter();
  const [competitor, setCompetitor] = useState("");
  const [status, setStatus] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<TaskT | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const comps = useApi<{ competitors: CompetitorLite[] }>("/api/competitors");
  const { data, error, reload } = useApi<TasksResp>(
    `/api/tasks${qs({ competitor, status, q, page, pageSize: PAGE_SIZE })}`,
    (d) => (d?.rows.some((r) => isLive(r.status)) ? 3000 : false),
  );

  async function act(t: TaskT, action: "rerun" | "cancel") {
    setBusy(t.id);
    try {
      const r = await api<{ id?: number }>(`/api/tasks/${t.id}/action`, "POST", { action });
      toast(action === "rerun" ? `已创建重跑任务 #${r.id}` : "已请求取消，将在当前请求结束后停止");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!del) return;
    try {
      await api(`/api/tasks/${del.id}`, "DELETE");
      toast(`已删除 ${taskTitle(del)}`);
      setPicked((p) => p.filter((x) => x !== del.id));
      setDel(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]));
  // 对比时旧任务在前（id 小的更早创建）
  const [cmpA, cmpB] = [...picked].sort((a, b) => a - b);
  const rows = data?.rows ?? [];
  const filtered = !!(competitor || status || q);

  return (
    <>
      <PageHead
        title="监测任务"
        sub="每一次抓取都会留档，可随时回看结果、重跑或与历史任务对比"
        actions={
          <>
            {picked.length === 2 && (
              <Link className="btn ghost" href={`/compare?tab=tasks&a=${cmpA}&b=${cmpB}`}><Icon name="compare" />对比所选 2 个任务</Link>
            )}
            <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" />新建任务</button>
          </>
        }
      />

      <div className="card">
        <div className="toolbar">
          <div className="search grow">
            <Icon name="search" />
            <input type="search" placeholder="搜索任务名 / 关键词" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="搜索任务" />
          </div>
          <select value={competitor} onChange={(e) => { setCompetitor(e.target.value); setPage(1); }} aria-label="按竞品筛选">
            <option value="">全部竞品</option>
            {comps.data?.competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="按状态筛选">
            <option value="">全部状态</option>
            {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="hint sp">{picked.length > 0 ? `已选 ${picked.length}/2（选 2 个可对比）` : "勾选两个任务可做前后对比"}</span>
        </div>

        {error && <div className="alert" style={{ margin: 16 }}>{error}</div>}

        {!data && !error ? (
          <div style={{ padding: 20, display: "grid", gap: 12 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={34} />)}</div>
        ) : rows.length === 0 ? (
          <Empty
            title={filtered ? "没有符合条件的任务" : "还没有监测任务"}
            action={!filtered && <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" />新建第一个任务</button>}
          >
            {filtered ? "试试放宽筛选条件" : "填写关键词并选择平台，系统会自动抓取并归集投放账号"}
          </Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>任务</th><th>状态</th><th>来源</th><th>平台</th><th>关键词</th><th>时间范围</th>
                  <th>结果</th><th>创建时间</th><th className="r">耗时</th><th className="r">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const p = t.progress;
                  const live = isLive(t.status);
                  return (
                    <tr key={t.id} className="row" onClick={() => router.push(`/tasks/${t.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} aria-label={`选择任务 ${t.id}`} />
                      </td>
                      <td>
                        <div className="who">
                          <div>
                            <div className="n" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {t.competitorColor && <Swatch color={t.competitorColor} />}{taskTitle(t)}
                            </div>
                            <div className="s num">#{t.id}{t.competitorName && t.name !== t.competitorName ? ` · ${t.competitorName}` : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="muted nowrap">{SOURCE_LABEL[t.source] ?? t.source}</td>
                      <td className="nowrap">{platformText(t.config)}</td>
                      <td><div className="kw" title={t.config.keywords.join("、")}>{t.config.keywords.join("、")}</div></td>
                      <td className="nowrap muted num">{rangeText(t.config)}</td>
                      <td className="nowrap">
                        {live ? (
                          <span className="muted num">命中 {p.postsMatched ?? 0} 条…</span>
                        ) : p.accounts != null ? (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <b className="num">{p.accounts}</b><span className="faint">账号</span>
                            {!!p.newAccounts && <Badge kind="ok">新增 {p.newAccounts}</Badge>}
                            {!!p.repeatAccounts && <Badge kind="hot">复投 {p.repeatAccounts}</Badge>}
                          </span>
                        ) : <span className="faint">—</span>}
                      </td>
                      <td className="muted nowrap">{fmtDateTime(t.createdAt)}</td>
                      <td className="r muted nowrap num">{durationText(t)}</td>
                      <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {live ? (
                            <button className="btn ghost sm" disabled={busy === t.id} onClick={() => act(t, "cancel")}>取消</button>
                          ) : (
                            <button className="btn ghost sm" disabled={busy === t.id} onClick={() => act(t, "rerun")} title="用相同配置重新抓取（1 小时内的请求命中缓存，不重复计费）">
                              <Icon name="refresh" size={13} />重跑
                            </button>
                          )}
                          <button className="btn danger sm" onClick={() => setDel(t)} aria-label="删除任务"><Icon name="trash" size={13} /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>

      {creating && (
        <NewTaskModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); toast(`任务 #${id} 已创建`); router.push(`/tasks/${id}`); }}
        />
      )}
      {del && (
        <Modal
          title="删除任务"
          onClose={() => setDel(null)}
          footer={<><button className="btn ghost" onClick={() => setDel(null)}>取消</button><button className="btn danger" onClick={confirmDelete}>确认删除</button></>}
        >
          <p style={{ margin: 0 }}>将删除 <b>{taskTitle(del)}</b>（#{del.id}）及其抓取到的作品快照与调用日志，<b>不可恢复</b>。{isLive(del.status) && "任务正在运行，会先被取消。"}</p>
          <p className="hint" style={{ marginBottom: 0 }}>账号库中其他任务的数据不受影响。</p>
        </Modal>
      )}
    </>
  );
}
