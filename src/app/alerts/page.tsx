"use client";
import { useRouter } from "next/navigation";
import { Empty, Icon, PageHead, Skeleton, type IconName } from "@/components/ui";
import { relTime } from "@/lib/format";
import { api, toast, useApi } from "@/lib/useApi";

type AlertT = { id: number; ts: number; type: string; title: string; body: string | null; href: string | null; read: number };

const META: Record<string, { icon: IconName; color: string; bg: string; label: string }> = {
  task_done: { icon: "list", color: "var(--ok)", bg: "var(--ok-soft)", label: "任务完成" },
  new_repeat: { icon: "flame", color: "var(--hot)", bg: "var(--hot-soft)", label: "新晋复投" },
  task_failed: { icon: "x", color: "var(--hot)", bg: "var(--hot-soft)", label: "任务异常" },
  budget: { icon: "chart", color: "var(--warn)", bg: "var(--warn-soft)", label: "预算提醒" },
  schedule: { icon: "clock", color: "var(--info)", bg: "var(--info-soft)", label: "定时监控" },
};

export default function AlertsPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<{ unread: number; items: AlertT[] }>("/api/alerts", () => 30_000);

  async function markAll() {
    try {
      await api("/api/alerts", "POST", {});
      toast("已全部标为已读");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function open(a: AlertT) {
    if (!a.read) await api("/api/alerts", "POST", { ids: [a.id] }).catch(() => {});
    if (a.href) router.push(a.href);
    else await reload();
  }

  return (
    <>
      <PageHead
        title="提醒中心"
        sub="任务结果、新晋复投账号、预算与异常通知"
        actions={<button className="btn ghost" disabled={!data?.unread} onClick={markAll}>全部标为已读{data?.unread ? `（${data.unread}）` : ""}</button>}
      />
      {error && <div className="alert">{error}</div>}
      <div className="card">
        {!data && !error ? (
          <div style={{ padding: 20, display: "grid", gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={52} />)}</div>
        ) : data && data.items.length === 0 ? (
          <Empty title="暂无提醒">任务完成、出现新的高频复投账号或预算接近上限时，会在这里通知你。</Empty>
        ) : data && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.items.map((a) => {
              const m = META[a.type] ?? META.task_done;
              return (
                <li key={a.id}>
                  <button
                    onClick={() => open(a)}
                    style={{
                      display: "flex", gap: 14, alignItems: "flex-start", width: "100%", textAlign: "left", padding: "14px 20px", border: 0,
                      borderBottom: "1px solid var(--line-2)", background: a.read ? "transparent" : "var(--accent-soft)", color: "inherit", cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", flex: "none", background: m.bg, color: m.color }}><Icon name={m.icon} size={17} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <b style={{ fontWeight: a.read ? 500 : 700 }}>{a.title}</b>
                        <span className="badge" style={{ background: m.bg, color: m.color }}>{m.label}</span>
                        {!a.read && <i className="dot" style={{ color: "var(--accent)" }} aria-label="未读" />}
                      </span>
                      {a.body && <span className="muted" style={{ display: "block", marginTop: 2 }}>{a.body}</span>}
                    </span>
                    <span className="faint nowrap" style={{ fontSize: 12 }}>{relTime(a.ts)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
