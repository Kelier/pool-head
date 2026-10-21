"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccountDrawer } from "@/components/AccountDrawer";
import { AccountTable, type SortState } from "@/components/AccountTable";
import { Donut, HBars } from "@/components/charts";
import { ExportMenu } from "@/components/ExportMenu";
import { Empty, Icon, Kpi, PageHead, Pager, Skeleton } from "@/components/ui";
import { ACCOUNT_STATUS, PLATFORM_LIST, PLATFORM_NAME, TIER_COLOR, TIER_LABEL } from "@/lib/consts";
import { fmtNum, fmtPct, qs } from "@/lib/format";
import type { AccountRow } from "@/lib/queries";
import { useApi } from "@/lib/useApi";

type Resp = {
  total: number; page: number; pageSize: number; rows: AccountRow[];
  summary: { accounts: number; repeat: number; posts: number; newThisWeek: number; repeatRate: number; tiers: Record<string, number>; platforms: Record<string, number> };
};

const KEYS = ["q", "competitor", "platform", "tier", "status", "tag", "fMin", "fMax", "repeat", "sort", "dir", "page"] as const;
type Key = (typeof KEYS)[number];

function AccountsInner() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const get = (k: Key) => sp.get(k) ?? "";
  const [qInput, setQInput] = useState(get("q"));
  const [open, setOpen] = useState<{ platform: string; uid: string } | null>(null);

  // 筛选状态全部放在 URL，刷新可还原
  const set = useCallback((patch: Partial<Record<Key, string>>, keepPage = false) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    if (!keepPage && !("page" in patch)) n.delete("page");
    const s = n.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [sp, router, path]);

  useEffect(() => {
    if (qInput === get("q")) return;
    const t = setTimeout(() => set({ q: qInput }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const sort: SortState = { sort: get("sort") || "count", dir: get("dir") === "asc" ? "asc" : "desc" };
  const page = Number(get("page")) || 1;
  const filterQs = qs({
    q: get("q"), competitor: get("competitor"), platform: get("platform"), tier: get("tier"), status: get("status"), tag: get("tag"),
    fMin: get("fMin"), fMax: get("fMax"), repeat: get("repeat") === "1", sort: sort.sort, dir: sort.dir,
  });
  const { data, error, reload } = useApi<Resp>(`/api/accounts${filterQs}${filterQs ? "&" : "?"}page=${page}&pageSize=25`);
  const comps = useApi<{ competitors: Array<{ id: number; name: string }> }>("/api/competitors");

  const active = KEYS.some((k) => k !== "sort" && k !== "dir" && k !== "page" && get(k));
  const onSort = (key: string) => set(sort.sort === key ? { sort: key, dir: sort.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" });
  const s = data?.summary;

  return (
    <>
      <PageHead
        title="账号库"
        sub="汇总所有竞品、所有任务抓取到的投放账号；同一作品跨任务只计一次"
        actions={<ExportMenu query={filterQs.slice(1).replace(/&?(page|pageSize)=\d+/g, "")} />}
      />

      <div className="stack" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        <div className="grid cols-4">
          <Kpi label="投放账号" value={s ? fmtNum(s.accounts) : "—"} sub="符合当前筛选" icon="users" />
          <Kpi label="高频复投" value={s ? fmtNum(s.repeat) : "—"} hot={!!s?.repeat} sub={s ? `复投率 ${fmtPct(s.repeatRate)}` : undefined} icon="flame" />
          <Kpi label="投放作品" value={s ? fmtNum(s.posts) : "—"} sub="已扣除人工否决" icon="file" />
          <Kpi label="近 7 天新增" value={s ? fmtNum(s.newThisWeek) : "—"} sub="首次被发现的账号" icon="plus" />
        </div>

        {s && s.accounts > 0 && (
          <div className="grid cols-2">
            <section className="card pad">
              <h2>层级分布</h2>
              <Donut
                center={{ v: String(s.accounts), l: "账号" }}
                items={Object.entries(TIER_LABEL).map(([k, l]) => ({ label: l, value: s.tiers[k] ?? 0, color: TIER_COLOR[k] })).filter((i) => i.value > 0)}
              />
            </section>
            <section className="card pad">
              <h2>平台分布</h2>
              <HBars items={Object.entries(s.platforms).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: PLATFORM_NAME[k] ?? k, value: v }))} total={s.accounts} />
            </section>
          </div>
        )}

        <section className="card">
          <div className="toolbar">
            <div className="search grow">
              <Icon name="search" />
              <input type="search" placeholder="搜索账号名 / UID / 备注" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="搜索账号" />
            </div>
            <select value={get("competitor")} onChange={(e) => set({ competitor: e.target.value })} aria-label="竞品">
              <option value="">全部竞品</option>
              {comps.data?.competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={get("platform")} onChange={(e) => set({ platform: e.target.value })} aria-label="平台">
              <option value="">全部平台</option>
              {PLATFORM_LIST.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={get("tier")} onChange={(e) => set({ tier: e.target.value })} aria-label="层级">
              <option value="">全部层级</option>
              {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={get("status")} onChange={(e) => set({ status: e.target.value })} aria-label="运营状态">
              <option value="">全部状态</option>
              {Object.entries(ACCOUNT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="toolbar">
            <span className="label">粉丝</span>
            <input type="number" placeholder="最小" style={{ width: 110 }} defaultValue={get("fMin")} key={`fmin-${get("fMin")}`} onBlur={(e) => e.target.value !== get("fMin") && set({ fMin: e.target.value })} onKeyDown={(e) => e.key === "Enter" && set({ fMin: e.currentTarget.value })} aria-label="粉丝下限" />
            <span className="faint">~</span>
            <input type="number" placeholder="最大" style={{ width: 110 }} defaultValue={get("fMax")} key={`fmax-${get("fMax")}`} onBlur={(e) => e.target.value !== get("fMax") && set({ fMax: e.target.value })} onKeyDown={(e) => e.key === "Enter" && set({ fMax: e.currentTarget.value })} aria-label="粉丝上限" />
            <input type="text" placeholder="标签" style={{ width: 120 }} defaultValue={get("tag")} key={`tag-${get("tag")}`} onBlur={(e) => e.target.value !== get("tag") && set({ tag: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && set({ tag: e.currentTarget.value.trim() })} aria-label="标签" />
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={get("repeat") === "1"} onChange={(e) => set({ repeat: e.target.checked ? "1" : "" })} />只看高频复投
            </label>
            {active && <button className="btn ghost sm sp" onClick={() => { setQInput(""); router.replace(path, { scroll: false }); }}>清除全部筛选</button>}
          </div>

          {error && <div className="alert" style={{ margin: 16 }}>{error}</div>}
          {!data && !error ? (
            <div style={{ padding: 20, display: "grid", gap: 12 }}>{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={40} />)}</div>
          ) : data && data.rows.length === 0 ? (
            <Empty title={active ? "没有符合条件的账号" : "账号库还是空的"}>
              {active ? "试试放宽筛选条件" : "先在「监测任务」或「竞品管理」里运行一次抓取，投放账号会自动汇总到这里"}
            </Empty>
          ) : data && (
            <AccountTable rows={data.rows} onOpen={(a) => setOpen({ platform: a.platform, uid: a.uid })} sort={sort} onSort={onSort} />
          )}
          {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: p > 1 ? String(p) : "" }, true)} />}
        </section>
      </div>

      {open && <AccountDrawer platform={open.platform} uid={open.uid} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

export default function AccountsPage() {
  return <Suspense fallback={<Skeleton h={300} />}><AccountsInner /></Suspense>;
}
