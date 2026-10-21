"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/consts";
import { fmtPct, relTime } from "@/lib/format";
import { api, toast, useApi } from "@/lib/useApi";
import { Empty, Icon, Modal, PageHead, Skeleton, StatusBadge } from "@/components/ui";
import { NewTaskModal } from "@/components/NewTaskModal";
import { scheduleText, useCompetitorPlatforms, type ScheduleRow, type Summary } from "../_dash";
import { CompetitorModal, type CompetitorInput } from "./_parts";

type Row = Summary & Omit<CompetitorInput, "platforms"> & { id: number; lastTask: { id: number; status: string; finished_at: number | null } | null; schedule: ScheduleRow | null };

export default function CompetitorsPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<{ competitors: Row[] }>("/api/competitors");
  const [editing, setEditing] = useState<CompetitorInput | "new" | null>(null);
  const [running, setRunning] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const plats = useCompetitorPlatforms(data?.competitors.map((c) => c.id) ?? []);
  const full = (c: Row): CompetitorInput => ({ id: c.id, name: c.name, color: c.color, keywords: c.keywords, note: c.note, platforms: plats[c.id] ?? [] });

  async function remove(c: Row) {
    try {
      await api(`/api/competitors/${c.id}`, "DELETE");
      toast(`已删除「${c.name}」`);
      setDeleting(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <>
      <PageHead title="竞品管理" sub="把要监测的竞品建成对象：绑定关键词与平台后，抓取结果会按竞品累计，并可设置定时监控"
        actions={<button className="btn" onClick={() => setEditing("new")}><Icon name="plus" />新建竞品</button>} />

      {error && !data && <div className="alert">加载失败：{error}</div>}
      {!data && !error && (
        <div className="grid cols-3">{[0, 1, 2].map((i) => <div key={i} className="card pad"><Skeleton h={20} w={120} /><div style={{ height: 12 }} /><Skeleton h={60} /></div>)}</div>
      )}
      {data && data.competitors.length === 0 && (
        <div className="card">
          <Empty title="还没有监测的竞品" action={<button className="btn" onClick={() => setEditing("new")}><Icon name="plus" />新建竞品</button>}>
            例如「LibTV」，关键词填 libtv、libtv导演台，平台选抖音、小红书、B站。
          </Empty>
        </div>
      )}
      {data && data.competitors.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {data.competitors.map((c) => (
            <div key={c.id} className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 4, background: c.color }} />
              <div style={{ padding: "16px 20px", display: "grid", gap: 14, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/competitors/${c.id}`} style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{c.name}</Link>
                    <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{(plats[c.id] ?? []).map((p) => PLATFORM_NAME[p] ?? p).join(" · ") || "\u00a0"}</div>
                  </div>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>定时：{scheduleText(c.schedule)}</span>
                </div>
                <div>{c.keywords.map((k) => <span key={k} className="tag">{k}</span>)}</div>
                <div className="grid" style={{ gap: 8, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <Stat label="投放账号" value={c.accounts} />
                  <Stat label="高频复投" value={c.repeat} hot={c.repeat > 0} sub={fmtPct(c.repeatRate)} />
                  <Stat label="命中作品" value={c.posts} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }} className="muted">
                  最近抓取：{c.lastTask ? <><StatusBadge status={c.lastTask.status} />{relTime(c.lastTask.finished_at)}</> : "从未抓取"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
                <button className="btn sm" onClick={() => setRunning(c)}><Icon name="play" size={13} />立即抓取</button>
                <Link href={`/competitors/${c.id}`} className="btn ghost sm">详情</Link>
                <button className="btn ghost sm" onClick={() => setEditing(full(c))}>编辑</button>
                <button className="btn danger sm" style={{ marginLeft: "auto" }} onClick={() => setDeleting(c)} aria-label={`删除 ${c.name}`}><Icon name="trash" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CompetitorModal initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
          onSaved={(id) => { const isNew = editing === "new"; setEditing(null); reload(); if (isNew) router.push(`/competitors/${id}`); }} />
      )}
      {running && (
        <NewTaskModal preset={{ competitorId: running.id, name: running.name, keywords: running.keywords, platforms: plats[running.id] }}
          onClose={() => setRunning(null)} onCreated={(id) => router.push(`/tasks/${id}`)} />
      )}
      {deleting && (
        <Modal title={`删除「${deleting.name}」？`} onClose={() => setDeleting(null)}
          footer={<><button className="btn ghost" onClick={() => setDeleting(null)}>取消</button><button className="btn danger" onClick={() => remove(deleting)}>确认删除</button></>}>
          <p style={{ margin: 0 }} className="muted">将同时删除该竞品的<b>全部抓取任务、作品数据与定时计划</b>，无法恢复。账号库中的账号资料与你写的备注会保留。</p>
        </Modal>
      )}
    </>
  );
}

function Stat({ label, value, hot, sub }: { label: string; value: number; hot?: boolean; sub?: string }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "8px 12px" }}>
      <div className="faint" style={{ fontSize: 12 }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, color: hot ? "var(--hot)" : undefined }}>{value}{sub && <span className="faint" style={{ fontSize: 11, fontWeight: 400 }}> {sub}</span>}</div>
    </div>
  );
}
