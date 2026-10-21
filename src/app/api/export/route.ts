import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildSheets, contentDisposition, isExportFormat, isExportType, renderCsv, renderJson, renderXlsx, type ExportType,
} from "../../../lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (message: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error: message, ...extra }, { status });

function findChrome(): string | null {
  const env = process.env.CHROME_PATH;
  if (env) return existsSync(env) ? env : null; // 显式配置了就只认它，路径不对要报出来
  const fixed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  const hit = fixed.find((p) => existsSync(p));
  if (hit) return hit;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const n of ["google-chrome", "chromium", "chromium-browser"]) {
      const p = path.join(dir, n);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

/** 无头 Chrome 把 /print/<type> 打印成 PDF。参数全部走 spawn 数组，不经过 shell。 */
async function printPdf(chrome: string, url: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "gtm-pdf-"));
  const out = path.join(dir, "out.pdf");
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        chrome,
        [
          "--headless=new", "--disable-gpu", "--no-sandbox", "--no-proxy-server", "--no-pdf-header-footer",
          `--user-data-dir=${path.join(dir, "profile")}`, // 独立 profile：不与正在运行的 Chrome 冲突
          "--virtual-time-budget=4000", `--print-to-pdf=${out}`, url,
        ],
        { stdio: "ignore" },
      );
      const timer = setTimeout(() => (p.kill("SIGKILL"), reject(new Error("生成 PDF 超时（45s）"))), 45_000);
      p.on("error", (e) => (clearTimeout(timer), reject(e)));
      p.on("exit", (code) => (clearTimeout(timer), code === 0 ? resolve() : reject(new Error(`Chrome 退出码 ${code}`))));
    });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// GET /api/export?type=accounts|posts|compare-tasks|compare-competitors|report&format=csv|xlsx|pdf|json
//   + 与 /api/accounts 相同的筛选参数（accounts/posts）；compare-tasks: a,b；compare-competitors: ids；report: id
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const type = sp.get("type") ?? "accounts";
  const format = sp.get("format") ?? "csv";
  if (!isExportType(type)) return err("未知导出类型");
  if (!isExportFormat(format)) return err("未知导出格式（支持 csv / xlsx / pdf / json）");

  try {
    if (format === "pdf") return await pdfResponse(type, url);

    const built = buildSheets(type, sp);
    const base = { "Content-Disposition": contentDisposition(`${built.filename}.${format}`) };
    if (format === "xlsx") {
      const buf = await renderXlsx(built);
      return new NextResponse(new Uint8Array(buf), { headers: { ...base, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }
    if (format === "json") return new NextResponse(renderJson(built), { headers: { ...base, "Content-Type": "application/json; charset=utf-8" } });
    return new NextResponse(renderCsv(built), { headers: { ...base, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (e) {
    return err((e as Error).message);
  }
}

async function pdfResponse(type: ExportType, url: URL) {
  // 先在这里构建一次：参数不合法（如竞品不存在）直接 400，而不是让 Chrome 打印出一张错误页
  const built = buildSheets(type, url.searchParams);
  const forward = new URLSearchParams(url.searchParams);
  forward.delete("type");
  forward.delete("format");
  const qs = forward.toString();
  const previewUrl = `${url.origin}/print/${type}${qs ? `?${qs}` : ""}`; // type 已通过白名单

  const chrome = findChrome();
  if (!chrome) {
    return err('未找到 Chrome/Chromium，请设置 CHROME_PATH，或在浏览器里打开预览页使用"打印→另存为 PDF"', 501, { previewUrl });
  }
  try {
    const pdf = await printPdf(chrome, previewUrl);
    if (pdf.subarray(0, 4).toString() !== "%PDF") return err("PDF 生成失败：输出不是有效的 PDF", 500, { previewUrl });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(`${built.filename}.pdf`) },
    });
  } catch (e) {
    return err(`PDF 生成失败：${(e as Error).message}`, 500, { previewUrl });
  }
}
