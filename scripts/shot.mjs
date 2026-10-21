// 截图工具：node scripts/shot.mjs <url> <out.png> [light|dark] [width] [height] [full]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [url, out, scheme = "light", width = "1440", height = "900", full, clickSel] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=/tmp/chrome-shot-${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(200); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: +width, height: +height, deviceScaleFactor: 1, mobile: +width < 600 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(3500);
  if (clickSel) {
    // 触发 mousedown（用于验证自定义下拉等交互）
    await send("Runtime.evaluate", { expression: `(()=>{const el=document.querySelector(${JSON.stringify(clickSel)}); if(!el) return "no el"; el.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true})); return "ok"})()` });
    await sleep(600);
  }
  let clip;
  if (full) {
    const m = await send("Page.getLayoutMetrics");
    const h = Math.min(Math.ceil(m.result.cssContentSize.height), 5000);
    clip = { x: 0, y: 0, width: +width, height: h, scale: 1 };
  }
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full, ...(clip ? { clip } : {}) });
  writeFileSync(out, Buffer.from(r.result.data, "base64"));
  console.log("saved", out);
  ws.close();
} finally { proc.kill(); }
