"use client";
// 无依赖的 SVG 图表。颜色用 CSS 变量/传入色值，自动适配深浅色。
import { useEffect, useRef, useState } from "react";

/** 按容器实际宽度绘制，避免 viewBox 缩放导致文字被放大。 */
function useWidth(def: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(def);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [w, ref] as const;
}

const md = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export type Series = { name: string; color: string; data: number[] };

/** 多序列折线（带面积）。x 轴为周起始时间戳。 */
export function LineChart({ weeks, series, height = 220 }: { weeks: number[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [W, ref] = useWidth(640);
  const H = height, L = 34, R = 10, T = 12, B = 24;
  const max = Math.max(4, ...series.flatMap((s) => s.data));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, weeks.length - 1);
  const y = (v: number) => T + (1 - v / nice) * (H - T - B);
  return (
    <div ref={ref}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} role="img" aria-label="近 12 周投放趋势" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((k) => {
          const v = (nice / 4) * k;
          return (
            <g key={k}>
              <line className="grid-line" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text>
            </g>
          );
        })}
        {weeks.map((w, i) => (i % 2 === 0 || weeks.length < 8) && <text key={w} x={x(i)} y={H - 6} textAnchor="middle">{md(w)}</text>)}
        {series.map((s) => {
          const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          return (
            <g key={s.name}>
              <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.data.length - 1)},${y(0)}`} fill={s.color} opacity={0.08} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {hover != null && <circle cx={x(hover)} cy={y(s.data[hover])} r={4} fill={s.color} />}
            </g>
          );
        })}
        {weeks.map((_, i) => (
          <rect key={i} x={x(i) - (W - L - R) / weeks.length / 2} y={T} width={(W - L - R) / weeks.length} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" />}
      </svg>
      <div className="legend" style={{ marginTop: 6, minHeight: 20 }}>
        {hover != null && <span className="num"><b>{md(weeks[hover])} 当周</b></span>}
        {series.map((s) => (
          <span key={s.name}><i className="swatch" style={{ background: s.color }} />{s.name}{hover != null && <b className="num">{s.data[hover]}</b>}</span>
        ))}
      </div>
    </div>
  );
}

/** 横向条形：label / value / 可选色。 */
export function HBars({ items, total }: { items: Array<{ label: string; value: number; color?: string; sub?: string }>; total?: number }) {
  const max = total ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div>
      {items.map((i) => (
        <div className="hbar" key={i.label}>
          <span>{i.label}</span>
          <span className="track"><i style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></span>
          <span className="num"><b>{i.value}</b>{i.sub && <span className="faint"> {i.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ items, size = 150, center }: { items: Array<{ label: string; value: number; color: string }>; size?: number; center?: { v: string; l: string } }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="分布">
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--line-2)" strokeWidth={16} />
        {total > 0 && items.map((i) => {
          const len = (i.value / total) * c;
          const el = <circle key={i.label} cx={70} cy={70} r={r} fill="none" stroke={i.color} strokeWidth={16} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
          off += len;
          return el;
        })}
        {center && (
          <>
            <text x={70} y={68} textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: "var(--text)" }}>{center.v}</text>
            <text x={70} y={86} textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>{center.l}</text>
          </>
        )}
      </svg>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        {items.map((i) => (
          <span key={i.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="swatch" style={{ background: i.color }} />{i.label}
            <b className="num">{i.value}</b><span className="faint num">{total ? Math.round((i.value / total) * 100) : 0}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 堆叠柱（调用量：真实 / 缓存命中）。 */
export function StackedColumns({ labels, series, height = 180 }: { labels: string[]; series: Series[]; height?: number }) {
  const [W, ref] = useWidth(640);
  const H = height, L = 30, B = 22, T = 8;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + s.data[i], 0));
  const max = Math.max(4, ...totals);
  const bw = ((W - L) / labels.length) * 0.6;
  return (
    <div ref={ref}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W}>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line className="grid-line" x1={L} x2={W} y1={T + (1 - k) * (H - T - B)} y2={T + (1 - k) * (H - T - B)} />
            <text x={L - 6} y={T + (1 - k) * (H - T - B) + 4} textAnchor="end">{Math.round(max * k)}</text>
          </g>
        ))}
        {labels.map((lb, i) => {
          const cx = L + ((i + 0.5) * (W - L)) / labels.length;
          let acc = 0;
          return (
            <g key={lb}>
              {series.map((s) => {
                const h = (s.data[i] / max) * (H - T - B);
                const yy = H - B - acc - h;
                acc += h;
                return h > 0 ? <rect key={s.name} x={cx - bw / 2} y={yy} width={bw} height={h} rx={2} fill={s.color}><title>{`${lb} ${s.name}: ${s.data[i]}`}</title></rect> : null;
              })}
              {(i % 2 === 0) && <text x={cx} y={H - 6} textAnchor="middle">{lb.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.name}><i className="swatch" style={{ background: s.color }} />{s.name}</span>)}</div>
    </div>
  );
}

export function Sparkline({ data, color = "var(--accent)", w = 96, h = 28 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i * (w - 2)) / Math.max(1, data.length - 1) + 1},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
