import type { AbsoluteTimeRange } from "../../types";
import { isValidDateRange } from "../../dates";

const CHINESE_RANGE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:到|至|[-–—~～－])\s*(?:(\d{4})\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})(?!\d)\s*[日号]?/;
const ISO_RANGE = /(\d{4}-\d{2}-\d{2})\s*(?:到|至|[-–—~～－])\s*(\d{4}-\d{2}-\d{2})/;
const DATE_HINT = /\d{1,2}\s*月\s*\d|\d{4}[-/.]\d{1,2}[-/.]\d|\d+\s*(?:到|至|[-–—~～－])\s*\d+\s*[日号]/;
export const DATE_CLARIFICATION = "请给出有效的起止日期，例如「11月1日到11月5日」。";

/** 从抓取请求提取绝对日期，年份默认取上海当前年份。 */
export function parseCrawlDates(text: string, now = new Date()): { range?: AbsoluteTimeRange; fragment?: string; error?: string } {
  const iso = ISO_RANGE.exec(text);
  const chinese = CHINESE_RANGE.exec(text);
  if (!iso && !chinese) return DATE_HINT.test(text) ? { error: DATE_CLARIFICATION } : {};

  let from: string, to: string;
  if (iso) {
    [, from, to] = iso;
  } else {
    const [, year, month, day, endYear, endMonth, endDay] = chinese!;
    const startYear = year ?? new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now);
    const pad = (part: string) => part.padStart(2, "0");
    from = `${startYear}-${pad(month)}-${pad(day)}`;
    to = `${endYear ?? startYear}-${pad(endMonth ?? month)}-${pad(endDay)}`;
  }
  if (!isValidDateRange(from, to)) return { error: DATE_CLARIFICATION };
  return { range: { type: "absolute", from, to }, fragment: (iso ?? chinese)![0] };
}

/** 校验模型或已保存提议携带的绝对日期。 */
export function absoluteFromArgs(args: Record<string, unknown>): AbsoluteTimeRange | undefined {
  const { from, to } = args;
  if (typeof from === "string" && typeof to === "string" && isValidDateRange(from, to)) return { type: "absolute", from, to };
  return undefined;
}
