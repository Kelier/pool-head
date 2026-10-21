/** CSV（带 UTF-8 BOM，Excel 直接打开不乱码；对以 = + - @ 开头的单元格加前缀，防公式注入）。 */
export function toCsv<T>(columns: Array<[string, (r: T) => unknown]>, rows: T[]): string {
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(([h]) => esc(h)).join(",");
  const body = rows.map((r) => columns.map(([, f]) => esc(f(r))).join(","));
  return "﻿" + [head, ...body].join("\r\n");
}
