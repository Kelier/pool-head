import type { AccountFilter } from "./queries";
import type { Tier } from "./settings";

const num = (v: string | null) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function parseAccountFilter(sp: URLSearchParams): AccountFilter {
  return {
    taskId: num(sp.get("task")),
    competitorId: num(sp.get("competitorScope")),
    competitor: num(sp.get("competitor")),
    platform: sp.get("platform") || undefined,
    q: sp.get("q") || undefined,
    tier: (sp.get("tier") as Tier) || undefined,
    status: sp.get("status") || undefined,
    tag: sp.get("tag") || undefined,
    repeatOnly: sp.get("repeat") === "1",
    fMin: num(sp.get("fMin")),
    fMax: num(sp.get("fMax")),
    sort: (sp.get("sort") as AccountFilter["sort"]) || undefined,
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
    page: num(sp.get("page")),
    pageSize: num(sp.get("pageSize")),
  };
}
