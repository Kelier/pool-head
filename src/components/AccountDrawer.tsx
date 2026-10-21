"use client";
import { useEffect, useState } from "react";
import type { AccountRow } from "@/lib/queries";
import { ACCOUNT_STATUS, PLATFORM_NAME } from "@/lib/consts";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { api, toast, useApi } from "@/lib/useApi";
import { Badge, CompetitorTags, Drawer, Icon, Skeleton, TierBadge } from "./ui";

type Post = {
  postId: string; url: string; title: string; publishedAt: number; likes: number; comments: number; plays: number;
  keywords: string[]; confidence: number; reasons: string[]; verdict: string; scope: string;
  competitor: { id: number; name: string; color: string } | null;
};
type Detail = { account: AccountRow; posts: Post[] };

/** 账号详情抽屉：画像、运营标注（状态/标签/备注）、全部投放作品时间线、人工否决误判。 */
export function AccountDrawer({ platform, uid, onClose, onChanged }: { platform: string; uid: string; onClose: () => void; onChanged?: () => void }) {
  const { data, reload } = useApi<Detail>(`/api/account?platform=${platform}&uid=${encodeURIComponent(uid)}`);
  const [status, setStatus] = useState("none");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setStatus(data.account.status);
    setTags(data.account.tags.join(", "));
    setNote(data.account.note);
    setDirty(false);
  }, [data]);

  async function saveMeta() {
    try {
      await api("/api/account", "PATCH", { platform, uid, status, tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), note });
      toast("已保存");
      setDirty(false);
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function flag(p: Post, verdict: "rejected" | "auto") {
    await api("/api/posts/flag", "POST", { platform, postId: p.postId, verdict });
    toast(verdict === "rejected" ? "已标记为非投放，计数已扣除" : "已恢复");
    await reload();
    onChanged?.();
  }

  const a = data?.account;
  const valid = data?.posts.filter((p) => p.verdict !== "rejected") ?? [];

  return (
    <Drawer
      onClose={onClose}
      title={
        a ? (
          <div className="who">
            <span className="av" style={{ width: 40, height: 40, fontSize: 16 }}>{(a.name || "?").slice(0, 1)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {a.profileUrl ? <a href={a.profileUrl} target="_blank" rel="noreferrer">{a.name} <Icon name="external" size={13} /></a> : a.name}
              </div>
              <div className="s" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                {PLATFORM_NAME[a.platform]} · 粉丝 {fmtNum(a.followers)} <TierBadge tier={a.tier} />
              </div>
            </div>
          </div>
        ) : <Skeleton h={40} w={220} />
      }
    >
      {!a ? <div className="stack"><Skeleton h={80} /><Skeleton h={200} /></div> : (
        <div className="stack" style={{ gap: 20 }}>
          <div className="grid cols-3" style={{ gap: 10 }}>
            <div className="card kpi"><div className="l">投放次数</div><div className={`v ${a.isRepeat ? "hot" : ""}`}>{valid.length}</div><div className="s">{a.isRepeat ? "高频复投" : a.label}</div></div>
            <div className="card kpi"><div className="l">首次投放</div><div className="v" style={{ fontSize: 18 }}>{fmtDate(a.firstAt)}</div></div>
            <div className="card kpi"><div className="l">最近投放</div><div className="v" style={{ fontSize: 18 }}>{fmtDate(a.lastAt)}</div></div>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 6 }}>涉及竞品</div>
            <CompetitorTags items={a.competitors} />
            <div className="hint" style={{ marginTop: 8 }}>命中关键词：{a.keywords.join("、") || "—"} · 均赞 {fmtNum(a.avgLikes)} · 均评 {fmtNum(a.avgComments)}</div>
          </div>

          <div className="card pad" style={{ background: "var(--surface-2)" }}>
            <div className="row2">
              <div className="field">
                <label>运营状态</label>
                <select value={status} onChange={(e) => (setStatus(e.target.value), setDirty(true))}>
                  {Object.entries(ACCOUNT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label>标签（逗号分隔）</label>
                <input type="text" value={tags} onChange={(e) => (setTags(e.target.value), setDirty(true))} placeholder="如：美妆、可合作" />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>备注</label>
              <textarea value={note} onChange={(e) => (setNote(e.target.value), setDirty(true))} placeholder="报价、联系人、合作意向…" />
            </div>
            <button className="btn sm" disabled={!dirty} onClick={saveMeta}>保存标注</button>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 4 }}>投放作品（{data!.posts.length}）</div>
            {data!.posts.map((p) => (
              <div key={p.postId + p.scope} className={`post ${p.verdict === "rejected" ? "rej" : ""}`}>
                <div style={{ minWidth: 0 }}>
                  <a className="t" href={p.url} target="_blank" rel="noreferrer">{p.title || p.url}</a>
                  <div className="m" style={{ marginTop: 4 }}>
                    <span className="num">{fmtDateTime(p.publishedAt)}</span>
                    <span className="num">赞 {fmtNum(p.likes)} · 评 {fmtNum(p.comments)}</span>
                    {p.competitor && <CompetitorTags items={[p.competitor]} />}
                    <span title={p.reasons.join("；")}><Badge kind={p.confidence >= 0.8 ? "ok" : ""}>置信 {p.confidence}</Badge></span>
                  </div>
                </div>
                <div>
                  {p.verdict === "rejected"
                    ? <button className="btn ghost sm" onClick={() => flag(p, "auto")}>恢复</button>
                    : <button className="btn ghost sm" title="判定有误？标记后该作品不再计入投放次数" onClick={() => flag(p, "rejected")}>不是投放</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="hint">首次发现于 {fmtDateTime(a.firstSeenAt)} · 最近抓取 {fmtDateTime(a.crawledAt)}</div>
        </div>
      )}
    </Drawer>
  );
}
