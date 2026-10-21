"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { AccountRow } from "@/lib/queries";
import { PLATFORM_NAME, TIER_LABEL } from "@/lib/consts";
import { fmtDate, fmtDateTime, fmtNum, fmtPct } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { Empty, Icon, Skeleton, Swatch } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { PlatformBars, TierDonut, type Summary } from "../../_dash";

type Detail = {
  competitor: { id: number; name: string; color: string; keywords: string[]; platforms: string[] };
  summary: Summary;
  trend: { weeks: number[]; series: Record<string, number[]> };
  tasks: Array<{ id: number; status: string; createdAt: number; finishedAt: number | null }>;
};
type AccountsResp = { total: number; rows: AccountRow[] };

// 打印时强制浅色配色：系统为深色模式时，PDF 也要是白底深字
const PRINT_LIGHT = `@media print { :root { --bg:#fff; --surface:#fff; --surface-2:#f6f7f9; --text:#0f172a; --text-2:#475569; --muted:#64748b; --line:#d9dde3; --line-2:#e9ecf0; --accent:#f0189f; --accent-text:#c70a85; --accent-soft:#fff0f9; --hot:#dc2626; --hot-soft:#fef2f2; --ok:#059669; --warn:#b45309; color-scheme: light; } @page { size: A4; margin: 14mm; } }`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ breakInside: "avoid", marginTop: 28 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px", paddingBottom: 8, borderBottom: "2px solid var(--text)" }}>{title}</h2>
      {children}
    </section>
  );
}

function MiniTable({ rows, cols }: { rows: AccountRow[]; cols: Array<[string, (a: AccountRow) => React.ReactNode, boolean?]> }) {
  return (
    <table style={{ fontSize: 12 }}>
      <thead><tr>{cols.map(([h, , r]) => <th key={h} className={r ? "r" : ""} style={{ position: "static" }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((a) => <tr key={`${a.platform}:${a.uid}`} style={{ breakInside: "avoid" }}>{cols.map(([h, f, r]) => <td key={h} className={r ? "r num" : ""} style={{ padding: "7px 10px" }}>{f(a)}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<Detail>(`/api/competitors/${id}`);
  const top = useApi<AccountsResp>(`/api/accounts?competitorScope=${id}&repeat=1&sort=count&pageSize=15`);
  const fresh = useApi<AccountsResp>(`/api/accounts?competitorScope=${id}&sort=seen&pageSize=50`);

  if (detail.error && !detail.data) return <div className="alert" style={{ marginTop: 32 }}>加载失败：{detail.error}</div>;
  if (!detail.data || !top.data || !fresh.data) return <div style={{ paddingTop: 40, display: "grid", gap: 12 }}><Skeleton h={40} w={320} /><Skeleton h={160} /><Skeleton h={240} /></div>;

  const { competitor: c, summary: s, trend, tasks } = detail.data;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const newOnes = fresh.data.rows.filter((a) => a.firstSeenAt >= weekAgo).slice(0, 15);
  const finished = tasks.filter((t) => t.status === "done" && t.finishedAt);
  const lastAt = finished[0]?.finishedAt ?? null;
  const first = trend.weeks[0];
  const series = trend.series[`c${c.id}`] ?? new Array(trend.weeks.length).fill(0);
  const metrics: Array<[string, string, string?]> = [
    ["投放账号", String(s.accounts)], ["高频复投账号", String(s.repeat), `复投率 ${fmtPct(s.repeatRate)}`],
    ["命中投放作品", String(s.posts), s.accounts ? `人均 ${(s.posts / s.accounts).toFixed(1)} 条` : undefined], ["本周新增账号", String(s.newThisWeek)],
  ];
  const topLabel = Object.entries(s.tiers).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];

  return (
    <article style={{ maxWidth: 900, margin: "0 auto", paddingTop: 24 }}>
      <style>{PRINT_LIGHT}</style>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <Link href={`/competitors/${c.id}`}>← 返回竞品详情</Link>
        <button className="btn" onClick={() => window.print()}><Icon name="download" />打印 / 保存为 PDF</button>
      </div>

      <header style={{ borderBottom: "1px solid var(--line)", paddingBottom: 20 }}>
        <div className="faint" style={{ fontSize: 12, letterSpacing: ".08em" }}>竞品投放监测报告</div>
        <h1 style={{ fontSize: 30, margin: "6px 0 10px", display: "flex", alignItems: "center", gap: 12 }}><Swatch color={c.color} />{c.name}</h1>
        <dl className="kv" style={{ gridTemplateColumns: "84px 1fr" }}>
          <dt>监测平台</dt><dd>{c.platforms.map((p) => PLATFORM_NAME[p] ?? p).join("、")}</dd>
          <dt>监测关键词</dt><dd>{c.keywords.join("、")}</dd>
          <dt>数据范围</dt><dd>近 12 周（{fmtDate(first)} 起，按作品发布时间）</dd>
          <dt>最近抓取</dt><dd>{lastAt ? fmtDateTime(lastAt) : "—"}（共 {tasks.length} 次抓取）</dd>
          <dt>生成时间</dt><dd>{fmtDateTime(Date.now())}</dd>
        </dl>
      </header>

      <Section title="一、核心指标">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {metrics.map(([l, v, sub]) => (
            <div key={l} className="card kpi">
              <div className="l">{l}</div>
              <div className="v" style={l === "高频复投账号" && s.repeat ? { color: "var(--hot)" } : undefined}>{v}</div>
              {sub && <div className="s">{sub}</div>}
            </div>
          ))}
        </div>
        <p className="muted" style={{ margin: "14px 0 0" }}>
          {s.accounts === 0 ? "暂无投放数据。" : <>
            监测期内共发现 <b>{s.accounts}</b> 个投放账号，其中 <b>{s.repeat}</b> 个被反复投放（{fmtPct(s.repeatRate)}）。
            {topLabel && <>账号以「{TIER_LABEL[topLabel[0]]}」为主（{topLabel[1]} 个）。</>}
          </>}
        </p>
      </Section>

      <Section title="二、投放趋势">
        <LineChart weeks={trend.weeks} series={[{ name: c.name, color: c.color, data: series }]} height={200} />
      </Section>

      <Section title="三、账号层级与平台分布">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div><div className="label" style={{ marginBottom: 8 }}>层级</div><TierDonut tiers={s.tiers} total={s.accounts} /></div>
          <div><div className="label" style={{ marginBottom: 8 }}>平台（账号数）</div><PlatformBars platforms={s.platforms} /></div>
        </div>
      </Section>

      <Section title="四、高频复投账号 Top 15">
        {top.data.rows.length === 0 ? <Empty title="暂无达到复投阈值的账号" /> : (
          <MiniTable rows={top.data.rows} cols={[
            ["账号", (a) => <b>{a.name}</b>], ["平台", (a) => PLATFORM_NAME[a.platform] ?? a.platform], ["粉丝", (a) => fmtNum(a.followers), true],
            ["层级", (a) => TIER_LABEL[a.tier]], ["投放次数", (a) => <b style={{ color: "var(--hot)" }}>{a.maxRepeat}</b>, true],
            ["首次 – 最近", (a) => `${fmtDate(a.firstAt)} – ${fmtDate(a.lastAt)}`], ["均赞", (a) => fmtNum(a.avgLikes), true],
          ]} />
        )}
      </Section>

      <Section title="五、本周新增账号">
        {newOnes.length === 0 ? <p className="muted" style={{ margin: 0 }}>近 7 天没有新发现的账号。</p> : (
          <MiniTable rows={newOnes} cols={[
            ["账号", (a) => <b>{a.name}</b>], ["平台", (a) => PLATFORM_NAME[a.platform] ?? a.platform], ["粉丝", (a) => fmtNum(a.followers), true],
            ["层级", (a) => TIER_LABEL[a.tier]], ["投放次数", (a) => a.promoCount, true], ["首次发现", (a) => fmtDateTime(a.firstSeenAt)],
          ]} />
        )}
      </Section>

      <Section title="六、方法说明">
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 12 }}>
          <li>数据来源：各平台公开内容，经 TikHub 接口按监测关键词检索；时间以作品发布时间为准。</li>
          <li>判定口径：作品标题或话题命中监测关键词即为候选，命中「合作、商单、邀请码、领取」等推广特征时提高置信度，低于阈值的不计入。</li>
          <li>投放次数：同一作品跨多次抓取只计一次；人工标记为「非投放」的作品已剔除；投放次数达到复投阈值（默认 ≥ 2 次）的账号为高频复投。</li>
          <li>层级按粉丝量划分（默认：头部 ≥ 100 万，腰部 10–100 万，尾部 1–10 万，素人 &lt; 1 万；可在「规则与设置」调整）。</li>
          <li>搜索结果受平台限制，无法保证全量，结论为「尽力抓取」下的趋势参考。</li>
        </ul>
      </Section>
    </article>
  );
}
