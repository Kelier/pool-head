"use client";
import { useEffect, useState } from "react";
import { StackedColumns } from "@/components/charts";
import { TagInput } from "@/components/TagInput";
import s from "./rules.module.css";
import { Icon, Kpi, PageHead, Skeleton, Tabs } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/format";
import { api, toast, useApi } from "@/lib/useApi";

type Rule = { label: string; words: string[]; weight: number };
type Settings = { repeatThreshold: number; minConfidence: number; tiers: { head: number; waist: number; tail: number }; rules: { promo: Rule[]; exclude: string[] } };
type Runtime = { qps: number; platformConcurrency: number; dailyBudget: number; maxRetries: number; timeoutMs: number };
type Usage = {
  days: Array<{ day: string; real: number; cached: number; errors: number }>;
  endpoints: Array<{ endpoint: string; calls: number; cached: number; errors: number; avgMs: number }>;
  cacheHitRate: number; real14d: number; budget: { used: number; limit: number };
};
type PromoForm = { label: string; words: string[]; weight: number };
type Form = { repeatThreshold: string; minConfidence: string; head: string; waist: string; tail: string; promo: PromoForm[]; exclude: string[] };

const toForm = (s: Settings): Form => ({
  repeatThreshold: String(s.repeatThreshold), minConfidence: String(s.minConfidence),
  head: String(s.tiers.head), waist: String(s.tiers.waist), tail: String(s.tiers.tail),
  promo: s.rules.promo.map((r) => ({ label: r.label, words: [...r.words], weight: r.weight })),
  exclude: [...s.rules.exclude],
});
const PRESETS: Array<[string, number]> = [["弱", 0.1], ["中", 0.2], ["强", 0.3]];
const round2 = (n: number) => Math.round(n * 100) / 100;

function RulesTab() {
  const { data, error } = useApi<{ settings: Settings }>("/api/settings");
  const [base, setBase] = useState<Form | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data && !f) { const x = toForm(data.settings); setBase(x); setF(x); } }, [data, f]);

  if (error) return <div className="alert">{error}</div>;
  if (!f || !base) return <div className="stack"><Skeleton h={220} /><Skeleton h={120} /></div>;

  const up = (p: Partial<Form>) => { setF({ ...f, ...p }); setMsg(null); };
  const setRow = (i: number, p: Partial<PromoForm>) => up({ promo: f.promo.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const head = Number(f.head), waist = Number(f.waist), tail = Number(f.tail);
  const conf = Number(f.minConfidence), n = Number(f.repeatThreshold);
  const err =
    !(head > waist && waist > tail) ? "分层阈值需满足：头部 > 腰部 > 尾部"
    : !(conf >= 0 && conf <= 1) ? "最低置信度需在 0–1 之间"
    : !(Number.isInteger(n) && n >= 2 && n <= 50) ? "复投阈值需为 2–50 的整数" : "";

  async function save() {
    if (!f) return;
    if (err) return setMsg({ kind: "err", text: err });
    setSaving(true);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", "PUT", {
        repeatThreshold: n, minConfidence: conf, tiers: { head, waist, tail },
        rules: { promo: f.promo.filter((p) => p.label.trim() || p.words.length).map((p) => ({ label: p.label.trim() || "未命名规则", words: p.words, weight: p.weight })), exclude: f.exclude },
      });
      const x = toForm(r.settings);
      setBase(x); setF(x);
      setMsg({ kind: "ok", text: "已保存" });
      toast("设置已保存");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="notice">规则只对<b>之后新建的任务</b>生效，历史数据不改写；个别误判请在账号详情里点「不是投放」。</div>

      <section className="card pad">
        <h2 style={{ marginBottom: 4 }}>推广特征词组</h2>
        <p className="hint" style={{ margin: "0 0 14px" }}>作品先命中任务关键词（基础分 0.5，话题标签命中 +0.1，上限 1），再按词组加分：<b>命中词组中任一词 → 置信度 + 权重</b>。</p>
        <div className={s.rows}>
          <div className={s.head}><span>词组名</span><span>关键词（回车或逗号添加）</span><span>加分权重</span><span /></div>
          {f.promo.map((r, i) => (
            <div key={i} className={s.row}>
              <input type="text" value={r.label} placeholder="词组名称" aria-label="词组名称" onChange={(e) => setRow(i, { label: e.target.value })} />
              <TagInput value={r.words} onChange={(words) => setRow(i, { words })} placeholder="如：合作、商单、广告" label={`${r.label || "词组"} 关键词`} />
              <div>
                <div className={s.step}>
                  <button type="button" aria-label="减少权重" disabled={r.weight <= 0} onClick={() => setRow(i, { weight: Math.max(0, round2(r.weight - 0.05)) })}>−</button>
                  <b>+{r.weight.toFixed(2)}</b>
                  <button type="button" aria-label="增加权重" disabled={r.weight >= 0.5} onClick={() => setRow(i, { weight: Math.min(0.5, round2(r.weight + 0.05)) })}>+</button>
                </div>
                <div className={s.preset}>
                  {PRESETS.map(([l, w]) => <button key={l} type="button" className={r.weight === w ? "on" : ""} onClick={() => setRow(i, { weight: w })}>{l}</button>)}
                </div>
              </div>
              <button type="button" className={s.iconbtn} aria-label="删除词组" title="删除词组" onClick={() => up({ promo: f.promo.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
        <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => up({ promo: [...f.promo, { label: "", words: [], weight: 0.2 }] })}><Icon name="plus" size={13} />添加词组</button>
      </section>

      <section className="card pad">
        <h2 style={{ marginBottom: 4 }}>排除词</h2>
        <p className="hint" style={{ margin: "0 0 10px" }}>作品标题或话题命中任一词即丢弃，用于过滤明显不是投放的内容（负面测评、转让、招聘等）。</p>
        <TagInput value={f.exclude} onChange={(exclude) => up({ exclude })} placeholder="如：避雷、吐槽、二手转让" label="排除词" />
      </section>

      <section className="card pad">
        <h2 style={{ marginBottom: 12 }}>口径参数</h2>
        <div className={s.params}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="ms">最低置信度</label>
            <input id="ms" type="number" step={0.05} min={0} max={1} value={f.minConfidence} onChange={(e) => up({ minConfidence: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rn">复投阈值 N</label>
            <div className={s.unit}><input id="rn" type="number" min={2} max={50} value={f.repeatThreshold} onChange={(e) => up({ repeatThreshold: e.target.value })} /><i>次</i></div>
          </div>
          {([["th", "头部 ≥", "head"], ["tw", "腰部 ≥", "waist"], ["tt", "尾部 ≥", "tail"]] as const).map(([id, l, k]) => (
            <div className="field" style={{ marginBottom: 0 }} key={id}>
              <label htmlFor={id}>{l}</label>
              <div className={s.unit}><input id={id} type="number" min={1} value={f[k]} onChange={(e) => up({ [k]: e.target.value } as Partial<Form>)} /><i>粉丝</i></div>
            </div>
          ))}
        </div>
        <div className={s.preview} aria-live="polite">
          {err ? <span style={{ color: "var(--hot)", borderColor: "var(--hot)" }}>{err}</span> : (
            <>
              <span>头部 <b>≥ {fmtNum(head)}</b></span>
              <span>腰部 <b>{fmtNum(waist)} – {fmtNum(head)}</b></span>
              <span>尾部 <b>{fmtNum(tail)} – {fmtNum(waist)}</b></span>
              <span>素人 <b>&lt; {fmtNum(tail)}</b></span>
            </>
          )}
        </div>
        <p className="hint" style={{ margin: "10px 0 0" }}>置信度 0.5 = 仅命中关键词即计入，调到 0.7 以上相当于要求同时带推广特征；分层阈值仅用于展示，改动立即作用于全部历史数据。</p>
      </section>

      <div className={s.savebar}>
        {dirty ? <span className={s.dirty}><i />有未保存的修改</span> : <span className={s.clean}>{msg?.kind === "ok" ? "✓ 已保存" : "所有修改已保存"}</span>}
        {msg?.kind === "err" && <span className="alert" style={{ padding: "4px 10px" }}>{msg.text}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn ghost" disabled={!dirty || saving} onClick={() => { setF(base); setMsg(null); }}>还原</button>
          <button className="btn" onClick={save} disabled={saving || !dirty || !!err}>{saving ? "保存中…" : "保存设置"}</button>
        </span>
      </div>
    </div>
  );
}

function UsageTab() {
  const usage = useApi<Usage>("/api/usage", () => 30_000);
  const cfg = useApi<{ runtime: Runtime }>("/api/settings");
  const u = usage.data;
  if (usage.error) return <div className="alert">{usage.error}</div>;
  if (!u) return <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}><Skeleton h={90} /><Skeleton h={220} /></div>;

  const pct = Math.min(100, (u.budget.used / u.budget.limit) * 100);
  const errs14 = u.days.reduce((a, d) => a + d.errors, 0);
  const rt = cfg.data?.runtime;

  return (
    <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div className="grid cols-4">
        <Kpi label="今日真实调用" value={`${u.budget.used}`} sub={`预算 ${u.budget.limit} · 剩余 ${Math.max(0, u.budget.limit - u.budget.used)}`} icon="chart" />
        <Kpi label="近 14 天真实调用" value={fmtNum(u.real14d)} sub="计费请求，不含缓存命中" icon="clock" />
        <Kpi label="缓存命中率" value={fmtPct(u.cacheHitRate)} sub="命中缓存的请求不出站、不计费" icon="refresh" />
        <Kpi label="近 14 天失败请求" value={errs14} hot={errs14 > 0} sub={u.real14d ? `失败率 ${fmtPct(errs14 / u.real14d)}` : "—"} icon="x" />
      </div>

      <section className="card pad">
        <h2>今日预算</h2>
        <div className="row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span className="muted">{u.budget.used} / {u.budget.limit} 次</span><b className="num">{pct.toFixed(0)}%</b></div>
        <div className={`bar ${pct > 90 ? "hot" : pct > 70 ? "warn" : ""}`}><i style={{ width: `${pct}%` }} /></div>
        <div className="hint" style={{ marginTop: 8 }}>达到 80% 会在提醒中心告警；达到 100% 时新请求被拒绝，任务进入「预算用尽」，定时监控会跳过。</div>
      </section>

      <section className="card pad">
        <h2>近 14 天调用量</h2>
        <StackedColumns
          labels={u.days.map((d) => d.day)}
          series={[
            { name: "成功请求", color: "#4f46e5", data: u.days.map((d) => d.real - d.errors) },
            { name: "失败请求", color: "#dc2626", data: u.days.map((d) => d.errors) },
            { name: "缓存命中", color: "#94a3b8", data: u.days.map((d) => d.cached) },
          ]}
        />
      </section>

      <div className="grid cols-2-1">
        <section className="card">
          <div className="card-head"><h2>各接口调用</h2></div>
          {u.endpoints.length === 0 ? <div className="empty">近 14 天暂无调用记录</div> : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>接口</th><th className="r">真实调用</th><th className="r">缓存命中</th><th className="r">失败</th><th className="r">平均耗时</th></tr></thead>
                <tbody>
                  {u.endpoints.map((e) => (
                    <tr key={e.endpoint}>
                      <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{e.endpoint.replace("/api/v1/", "")}</td>
                      <td className="r num">{e.calls}</td><td className="r num">{e.cached}</td>
                      <td className="r num" style={{ color: e.errors ? "var(--hot)" : undefined }}>{e.errors}</td>
                      <td className="r num">{(e.avgMs / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card pad" style={{ alignSelf: "start" }}>
          <h2>运行参数</h2>
          {rt ? (
            <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
              <dt>全局限速</dt><dd className="num">{rt.qps} QPS</dd>
              <dt>平台并发</dt><dd className="num">{rt.platformConcurrency}</dd>
              <dt>每日预算</dt><dd className="num">{rt.dailyBudget} 次</dd>
              <dt>最大重试</dt><dd className="num">{rt.maxRetries} 次</dd>
              <dt>请求超时</dt><dd className="num">{rt.timeoutMs / 1000} 秒</dd>
            </dl>
          ) : <Skeleton h={100} />}
          <div className="hint" style={{ marginTop: 12 }}>这些参数来自服务端 <code>.env</code>，修改后需重启服务生效。API 密钥只保存在服务端环境变量中，不会出现在页面或接口响应里。</div>
        </section>
      </div>
    </div>
  );
}

function AboutTab() {
  const { data } = useApi<{ runtime: Runtime }>("/api/settings");
  const rt = data?.runtime;
  const items: Array<[string, string, string]> = [
    ["全局令牌桶限速", rt ? `${rt.qps} QPS（硬上限 8，官方上限 10）` : "…", "所有对 TikHub 的请求只经过唯一出口，按令牌桶匀速放行；并叠加 50–300ms 随机抖动，避免固定节拍。"],
    ["并发闸", rt ? `全局 ≤ 4，单平台 ≤ ${rt.platformConcurrency}；同时最多 2 个任务` : "…", "限制同时在飞的请求数，避免多个任务叠加造成瞬时洪峰。"],
    ["退避重试", rt ? `最多 ${rt.maxRetries} 次，1s → 2s → 4s ±20%` : "…", "仅对 429、5xx 与超时重试，并遵守 Retry-After；参数/鉴权类 4xx 不重试。"],
    ["熔断保护", "1 分钟内连续失败 5 次 → 冷却 60 秒", "401/402/403（鉴权、余额、权限）直接熔断并暂停全部请求，任务标记为「已熔断」，避免失败风暴。"],
    ["缓存与请求合并", "搜索 1 小时 · 账号资料 24 小时", "相同请求命中缓存不出站、不计费；并发的相同请求合并为一次。重跑任务因此几乎零成本。"],
    ["调用预算", rt ? `每日 ${rt.dailyBudget} 次` : "…", "创建任务前先估算调用量，超预算直接拒绝；运行中达到上限会暂停并告警，定时监控自动跳过。"],
    ["翻页止损", "每词最多 N 页，早于起点即停", "搜索按最新排序，整页都早于时间范围起点时立刻停止翻页，不浪费调用。"],
    ["批量补全", "仅对命中的候选账号补粉丝数", "先搜索、去重，再补资料；抖音搜索结果自带粉丝数，无需额外调用。"],
  ];
  return (
    <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div className="notice">TikHub 已承担对各平台的反爬对抗；以下策略用于防止触顶官方限流、重复计费、失败风暴与预算失控。</div>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead><tr><th>策略</th><th>当前参数</th><th>作用</th></tr></thead>
            <tbody>
              {items.map(([n, v, d]) => (
                <tr key={n}><td className="nowrap" style={{ fontWeight: 600 }}>{n}</td><td className="num" style={{ minWidth: 220 }}>{v}</td><td className="muted">{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"rules" | "usage" | "about">("rules");
  // 支持 /settings?tab=usage 深链
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("tab");
    if (t === "usage" || t === "about") setTab(t);
  }, []);
  return (
    <>
      <PageHead title="规则与设置" sub="调整投放判定口径、粉丝分层，并监控 API 调用与防封策略" />
      <Tabs value={tab} onChange={setTab} options={[["rules", "判定规则"], ["usage", "调用监控"], ["about", "防封策略"]]} />
      {tab === "rules" ? <RulesTab /> : tab === "usage" ? <UsageTab /> : <AboutTab />}
    </>
  );
}
