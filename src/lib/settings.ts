import { db } from "./db";

export type PromoRule = { label: string; words: string[]; weight: number };

export type Settings = {
  repeatThreshold: number;
  minConfidence: number;
  /** 粉丝分层阈值：≥head 头部，≥waist 腰部，≥tail 尾部，其余素人 */
  tiers: { head: number; waist: number; tail: number };
  rules: { promo: PromoRule[]; exclude: string[] };
};

// 推广特征规则。PRD 中"具体特征后续补齐"，这里是可在「设置」里编辑的默认集。
export const DEFAULT_SETTINGS: Settings = {
  repeatThreshold: 2,
  minConfidence: 0.5,
  tiers: { head: 1_000_000, waist: 100_000, tail: 10_000 },
  rules: {
    promo: [
      { label: "推广/合作标识", words: ["合作", "商单", "广告", "赞助", "推广", "#ad", "sponsored", "paid partnership"], weight: 0.2 },
      { label: "引导转化话术", words: ["评论区领取", "主页领取", "链接领取", "点击体验", "免费试用", "立即注册", "戳链接"], weight: 0.2 },
      { label: "福利/邀请码", words: ["邀请码", "专属福利", "限时福利", "限时优惠", "新用户"], weight: 0.2 },
    ],
    exclude: [],
  },
};

export function getSettings(): Settings {
  const row = db().prepare("SELECT value FROM settings WHERE key='app'").get() as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const v = JSON.parse(row.value) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    tiers: { ...DEFAULT_SETTINGS.tiers, ...v.tiers },
    rules: { ...DEFAULT_SETTINGS.rules, ...v.rules },
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings();
  const next: Settings = {
    repeatThreshold: clampInt(patch.repeatThreshold, cur.repeatThreshold, 2, 50),
    minConfidence: clampNum(patch.minConfidence, cur.minConfidence, 0, 1),
    tiers: {
      head: clampInt(patch.tiers?.head, cur.tiers.head, 1, 1e9),
      waist: clampInt(patch.tiers?.waist, cur.tiers.waist, 1, 1e9),
      tail: clampInt(patch.tiers?.tail, cur.tiers.tail, 1, 1e9),
    },
    rules: {
      promo: (patch.rules?.promo ?? cur.rules.promo).map((r) => ({
        label: String(r.label).slice(0, 30),
        words: r.words.map((w) => String(w).trim()).filter(Boolean),
        weight: clampNum(r.weight, 0.2, 0, 0.5),
      })),
      exclude: (patch.rules?.exclude ?? cur.rules.exclude).map((w) => String(w).trim()).filter(Boolean),
    },
  };
  if (!(next.tiers.head > next.tiers.waist && next.tiers.waist > next.tiers.tail)) {
    throw new Error("分层阈值需满足：头部 > 腰部 > 尾部");
  }
  db().prepare("INSERT INTO settings(key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
  return next;
}

function clampInt(v: unknown, d: number, lo: number, hi: number) {
  const n = v == null || v === "" ? d : Math.round(Number(v));
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`参数超出范围 ${lo}–${hi}`);
  return n;
}
function clampNum(v: unknown, d: number, lo: number, hi: number) {
  const n = v == null || v === "" ? d : Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`参数超出范围 ${lo}–${hi}`);
  return n;
}

export type Tier = "head" | "waist" | "tail" | "micro" | "unknown";
export const TIER_LABEL: Record<Tier, string> = { head: "头部", waist: "腰部", tail: "尾部", micro: "素人", unknown: "未知" };

export function tierOf(followers: number | null | undefined, t: Settings["tiers"]): Tier {
  if (followers == null) return "unknown";
  if (followers >= t.head) return "head";
  if (followers >= t.waist) return "waist";
  if (followers >= t.tail) return "tail";
  return "micro";
}
