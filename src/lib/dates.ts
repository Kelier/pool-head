/** 校验真实存在的日历日期和区间顺序。 */
export function isValidDateRange(from: unknown, to: unknown): boolean {
  const isDate = (value: unknown): value is string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  return isDate(from) && isDate(to) && from <= to;
}
