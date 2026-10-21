"use client";
import type { AccountRow } from "@/lib/queries";
import { PLATFORM_NAME } from "@/lib/consts";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { AccountStatusBadge, Badge, CompetitorTags, TierBadge } from "./ui";

export type SortState = { sort: string; dir: "asc" | "desc" };

type Col = { key: string; label: string; sort?: string; r?: boolean; hide?: boolean };

export function AccountTable({
  rows, onOpen, sort, onSort, showCompetitors = true,
}: {
  rows: AccountRow[]; onOpen: (a: AccountRow) => void; sort?: SortState; onSort?: (key: string) => void; showCompetitors?: boolean;
}) {
  const cols: Col[] = [
    { key: "acc", label: "账号" },
    { key: "followers", label: "粉丝", sort: "followers", r: true },
    { key: "tier", label: "层级" },
    { key: "count", label: "投放次数", sort: "count", r: true },
    { key: "label", label: "频次标签" },
    { key: "comp", label: "涉及竞品", hide: !showCompetitors },
    { key: "range", label: "首次 / 最近投放", sort: "last" },
    { key: "likes", label: "均赞 / 均评", sort: "likes", r: true },
    { key: "kw", label: "命中关键词" },
    { key: "seen", label: "首次发现", sort: "seen" },
  ];
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {cols.filter((c) => !c.hide).map((c) => (
              <th key={c.key} className={`${c.r ? "r" : ""} ${c.sort && onSort ? "sortable" : ""}`} onClick={() => c.sort && onSort?.(c.sort)}>
                {c.label}{c.sort && sort?.sort === c.sort ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={`${a.platform}:${a.uid}`} className={`row ${a.isRepeat ? "repeat" : ""}`} onClick={() => onOpen(a)}>
              <td>
                <div className="who">
                  <span className="av">{(a.name || "?").slice(0, 1)}</span>
                  <div>
                    <div className="n">{a.name} <AccountStatusBadge status={a.status} /></div>
                    <div className="s">{PLATFORM_NAME[a.platform] ?? a.platform}{a.tags.length > 0 && ` · ${a.tags.join(" / ")}`}</div>
                  </div>
                </div>
              </td>
              <td className="r num">{fmtNum(a.followers)}</td>
              <td><TierBadge tier={a.tier} /></td>
              <td className="r">
                <span className={`count ${a.isRepeat ? "hot" : ""}`}>{a.maxRepeat}</span>
                {a.promoCount !== a.maxRepeat && <span className="faint num"> / {a.promoCount}</span>}
              </td>
              <td><Badge kind={a.isRepeat ? (a.maxRepeat > 3 ? "hot" : "warn") : ""}>{a.label}</Badge></td>
              {showCompetitors && <td><CompetitorTags items={a.competitors} /></td>}
              <td className="muted nowrap num">{fmtDate(a.firstAt)} – {fmtDate(a.lastAt)}</td>
              <td className="r num">{fmtNum(a.avgLikes)} / {fmtNum(a.avgComments)}</td>
              <td><div className="kw" title={a.keywords.join("、")}>{a.keywords.join("、")}</div></td>
              <td className="muted nowrap">{fmtDateTime(a.firstSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
