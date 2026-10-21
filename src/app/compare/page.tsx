"use client";
import { Suspense, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccountDrawer } from "@/components/AccountDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { Badge, Empty, Icon, Kpi, PageHead, Skeleton, Swatch, Tabs, TierBadge } from "@/components/ui";
import { PLATFORM_NAME, TASK_STATUS } from "@/lib/consts";
import { fmtDate, fmtDateTime, fmtNum, fmtPct } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { TasksResp } from "../tasks/_parts";

type Card = { platform: string; uid: string; name: string; profileUrl: string; followers: number | null; tier: string; count: number; lastAt: number };
type Kept = Card & { before: number; after: number; delta: number; upgraded: boolean };
type Side = { id: number; name: string | null; createdAt: number; accounts: number; repeat: number; posts: number };
type TaskCmp = { a: Side; b: Side; added: Card[]; lost: Card[]; kept: Kept[]; upgraded: Kept[] };
type CompCmp = {
  competitors: Array<{ id: number; name: string; color: string; exclusive: number; accounts: number; repeat: number; posts: number }>;
  matrix: Array<Array<{ inter: number; jaccard: number }>>;
  shared: Array<Card & { counts: Record<string, number>; total: number }>;
};
type Opened = { platform: string; uid: string } | null;

function Delta({ a, b, unit = "" }: { a: number; b: number; unit?: string }) {
  const d = b - a;
  if (d === 0) return <span className="faint">与旧任务持平</span>;
  return <span className={`delta ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}{unit} <span className="faint" style={{ fontWeight: 400 }}>较旧任务（{a}）</span></span>;
}

function AccountCell({ c }: { c: Card }) {
  return (
    <div className="who">
      <span className="av">{(c.name || "?").slice(0, 1)}</span>
      <div><div className="n">{c.name}</div><div className="s">{PLATFORM_NAME[c.platform] ?? c.platform}</div></div>
    </div>
  );
}

/* ───────── 任务对比 ───────── */
type Group = "added" | "lost" | "kept" | "upgraded";

function TaskCompare({ a, b, set, onOpen }: { a: string; b: string; set: (p: Record<string, string>) => void; onOpen: (o: Opened) => void }) {
  const tasks = useApi<TasksResp>("/api/tasks?pageSize=100");
  const { data, error, loading } = useApi<TaskCmp>(a && b && a !== b ? `/api/compare?a=${a}&b=${b}` : null);
  const [group, setGroup] = useState<Group>("added");
  const label = (t: TasksResp["rows"][number]) =>
    `#${t.id} ${t.name ?? "任务"} · ${fmtDate(t.createdAt)} · ${t.config.platforms.map((p) => PLATFORM_NAME[p] ?? p).join("/")}${t.status === "done" ? ` · ${t.progress.accounts ?? 0} 个账号` : `（${TASK_STATUS[t.status] ?? t.status}）`}`;
  const taskExport = (["xlsx", "pdf", "csv"] as const).map((f) => ({ label: f === "xlsx" ? "Excel (.xlsx)" : f === "pdf" ? "PDF" : "CSV", type: "compare-tasks", format: f, query: `a=${a}&b=${b}` }));

  const lists: Record<Group, Array<Card | Kept>> = data ? { added: data.added, lost: data.lost, kept: data.kept, upgraded: data.upgraded } : { added: [], lost: [], kept: [], upgraded: [] };
  const rows = lists[group];

  return (
    <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <section className="card pad">
        <div className="row2" style={{ gridTemplateColumns: "1fr auto 1fr", alignItems: "end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>旧任务（基准）</label>
            <select value={a} onChange={(e) => set({ a: e.target.value })}>
              <option value="">选择任务…</option>
              {tasks.data?.rows.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
            </select>
          </div>
          <button className="btn ghost" style={{ marginBottom: 0 }} title="交换" onClick={() => set({ a: b, b: a })}><Icon name="compare" /></button>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>新任务（对比）</label>
            <select value={b} onChange={(e) => set({ b: e.target.value })}>
              <option value="">选择任务…</option>
              {tasks.data?.rows.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
            </select>
          </div>
        </div>
        {a && b && a === b && <div className="alert" style={{ marginTop: 12 }}>请选择两个不同的任务</div>}
        <div className="hint" style={{ marginTop: 10 }}>典型用法：同一竞品的两次抓取（如上周 vs 本周），看新增了哪些账号、谁不再投放、谁升级成复投。</div>
      </section>

      {error && <div className="alert">{error}</div>}
      {!a || !b || a === b ? (
        <div className="card"><Empty title="选择两个任务开始对比">在上方分别选择旧任务与新任务；也可在「监测任务」里勾选两个任务一键对比。</Empty></div>
      ) : loading && !data ? (
        <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}><Skeleton h={90} /><Skeleton h={260} /></div>
      ) : data && (
        <>
          <div className="grid cols-4">
            <Kpi label="投放账号" value={data.b.accounts} sub={<Delta a={data.a.accounts} b={data.b.accounts} />} icon="users" />
            <Kpi label="高频复投账号" value={data.b.repeat} hot={data.b.repeat > 0} sub={<Delta a={data.a.repeat} b={data.b.repeat} />} icon="flame" />
            <Kpi label="投放作品" value={data.b.posts} sub={<Delta a={data.a.posts} b={data.b.posts} />} icon="file" />
            <Kpi label="新晋复投" value={data.upgraded.length} sub="旧任务未达阈值、新任务达到" icon="chart" />
          </div>

          <section className="card">
            <div className="card-head">
              <Tabs value={group} onChange={setGroup} options={[
                ["added", `新增 ${data.added.length}`], ["lost", `流失 ${data.lost.length}`], ["kept", `持续 ${data.kept.length}`], ["upgraded", `新晋复投 ${data.upgraded.length}`],
              ]} />
              <ExportMenu items={taskExport} />
            </div>
            <div className="hint" style={{ padding: "0 20px 10px" }}>
              {{ added: "新任务出现、旧任务没有的账号 —— 竞品最新开拓的合作对象", lost: "旧任务出现、新任务没有的账号 —— 可能停止合作，或本次抓取未覆盖", kept: "两次都出现的账号，按投放次数变化排序", upgraded: "旧任务里未达复投阈值，新任务里达到 —— 竞品正在加深绑定" }[group]}
              {` · 旧任务 ${fmtDateTime(data.a.createdAt)} → 新任务 ${fmtDateTime(data.b.createdAt)}`}
            </div>
            {rows.length === 0 ? <Empty title="这一组没有账号" /> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>账号</th><th className="r">粉丝</th><th>层级</th><th className="r">{group === "added" || group === "lost" ? "投放次数" : "次数变化"}</th><th>最近投放</th></tr></thead>
                  <tbody>
                    {rows.map((c) => {
                      const k = c as Kept;
                      return (
                        <tr key={c.platform + c.uid} className="row" onClick={() => onOpen({ platform: c.platform, uid: c.uid })}>
                          <td><AccountCell c={c} /></td>
                          <td className="r num">{fmtNum(c.followers)}</td>
                          <td><TierBadge tier={c.tier} /></td>
                          <td className="r num nowrap">
                            {group === "added" || group === "lost" ? <b>{c.count}</b> : (
                              <>{k.before} → <b>{k.after}</b>{" "}
                                {k.delta !== 0 && <span className={`delta ${k.delta > 0 ? "up" : "down"}`}>{k.delta > 0 ? "+" : ""}{k.delta}</span>}
                                {k.upgraded && <> <Badge kind="hot">新晋复投</Badge></>}</>
                            )}
                          </td>
                          <td className="muted nowrap">{fmtDate(c.lastAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ───────── 竞品对比 ───────── */
function CompetitorCompare({ ids, set, onOpen }: { ids: number[]; set: (p: Record<string, string>) => void; onOpen: (o: Opened) => void }) {
  const comps = useApi<{ competitors: Array<{ id: number; name: string; color: string }> }>("/api/competitors");
  const { data, error, loading } = useApi<CompCmp>(ids.length >= 2 ? `/api/compare?type=competitors&ids=${ids.join(",")}` : null);
  const toggle = (id: number) => set({ ids: (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]).join(",") });
  const list = comps.data?.competitors ?? [];

  return (
    <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <section className="card pad">
        <div className="label" style={{ marginBottom: 8 }}>选择要对比的竞品（至少 2 个）</div>
        {list.length === 0 && comps.data ? (
          <div className="muted">还没有竞品。先到「竞品管理」添加竞品并抓取数据。</div>
        ) : (
          <div className="chips">
            {list.map((c) => (
              <button key={c.id} className={`chip ${ids.includes(c.id) ? "on" : ""}`} onClick={() => toggle(c.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Swatch color={c.color} />{c.name}
              </button>
            ))}
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>共同 KOL = 同时为多个竞品投放过的账号，是竞品争夺的核心达人资源，也是你可以优先接触的对象。</div>
      </section>

      {error && <div className="alert">{error}</div>}
      {ids.length < 2 ? (
        <div className="card"><Empty title="选择至少两个竞品开始对比" /></div>
      ) : loading && !data ? (
        <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}><Skeleton h={120} /><Skeleton h={240} /></div>
      ) : data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(data.competitors.length, 4)}, minmax(0,1fr))` }}>
            {data.competitors.map((c) => (
              <div className="card kpi" key={c.id} style={{ borderTop: `3px solid ${c.color}` }}>
                <div className="l"><Swatch color={c.color} /><b style={{ color: "var(--text)" }}>{c.name}</b></div>
                <div className="v">{c.accounts}<span className="faint" style={{ fontSize: 13, fontWeight: 400 }}> 个账号</span></div>
                <div className="s">独占 <b className="num">{c.exclusive}</b> · 复投 <b className="num" style={{ color: c.repeat ? "var(--hot)" : undefined }}>{c.repeat}</b> · 作品 <b className="num">{c.posts}</b></div>
              </div>
            ))}
          </div>

          <div className="grid cols-2-1">
            <section className="card">
              <div className="card-head">
                <h2>共同 KOL（{data.shared.length}）</h2>
                <ExportMenu items={(["xlsx", "pdf", "csv"] as const).map((f) => ({ label: f === "xlsx" ? "Excel (.xlsx)" : f === "pdf" ? "PDF" : "CSV", type: "compare-competitors", format: f, query: `ids=${ids.join(",")}` }))} />
              </div>
              {data.shared.length === 0 ? <Empty title="这些竞品暂无共同投放的账号">各家投放的账号完全不重合。</Empty> : (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>账号</th><th className="r">粉丝</th><th>层级</th>
                        {data.competitors.map((c) => <th key={c.id} className="r nowrap"><Swatch color={c.color} /> {c.name}</th>)}
                        <th className="r">合计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shared.map((s) => (
                        <tr key={s.platform + s.uid} className="row" onClick={() => onOpen({ platform: s.platform, uid: s.uid })}>
                          <td><AccountCell c={s} /></td>
                          <td className="r num">{fmtNum(s.followers)}</td>
                          <td><TierBadge tier={s.tier} /></td>
                          {data.competitors.map((c) => <td key={c.id} className="r num">{s.counts[c.id] ? <b>{s.counts[c.id]}</b> : <span className="faint">—</span>}</td>)}
                          <td className="r"><span className="count">{s.total}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card pad" style={{ alignSelf: "start" }}>
              <h2>账号重合度</h2>
              <div className="tablewrap">
                <table style={{ tableLayout: "fixed" }}>
                  <thead>
                    <tr><th style={{ background: "transparent" }} />{data.competitors.map((c) => <th key={c.id} className="r" style={{ background: "transparent", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.competitors.map((row, i) => (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</td>
                        {data.competitors.map((col, j) => {
                          const m = data.matrix[i][j];
                          return (
                            <td key={col.id} className="r num" title={i === j ? `${row.name} 共 ${m.inter} 个账号` : `${row.name} ∩ ${col.name}：${m.inter} 个，Jaccard ${fmtPct(m.jaccard)}`}
                              style={{ background: i === j ? "var(--surface-2)" : `color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, m.jaccard * 2.5) * 70)}%, transparent)` }}>
                              <b>{m.inter}</b>{i !== j && <div style={{ fontSize: 11, opacity: 0.8 }}>{fmtPct(m.jaccard)}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="hint" style={{ marginTop: 10 }}>格内：共同账号数 / Jaccard 重合率（交集 ÷ 并集）。颜色越深，两家越依赖同一批达人。</div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function CompareInner() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const tab = sp.get("tab") === "competitors" ? "competitors" : "tasks";
  const a = sp.get("a") ?? "", b = sp.get("b") ?? "";
  const ids = (sp.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  const [open, setOpen] = useState<Opened>(null);

  const set = useCallback((patch: Record<string, string>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    router.replace(`${path}?${n.toString()}`, { scroll: false });
  }, [sp, router, path]);

  return (
    <>
      <PageHead title="对比分析" sub="看清竞品投放节奏的变化，以及竞品之间争夺的共同达人" />
      <Tabs value={tab} onChange={(v) => set({ tab: v })} options={[["tasks", "任务对比（前后变化）"], ["competitors", "竞品对比（共同 KOL）"]]} />
      {tab === "tasks" ? <TaskCompare a={a} b={b} set={set} onOpen={setOpen} /> : <CompetitorCompare ids={ids} set={set} onOpen={setOpen} />}
      {open && <AccountDrawer platform={open.platform} uid={open.uid} onClose={() => setOpen(null)} />}
    </>
  );
}

export default function ComparePage() {
  return <Suspense fallback={<Skeleton h={300} />}><CompareInner /></Suspense>;
}
