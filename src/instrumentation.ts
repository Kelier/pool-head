export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    // webhook 模式下，机器人与 Web 应用同进程：顺带推送系统提醒（长连接模式由 pnpm bot 负责）
    if (process.env.FEISHU_APP_ID && process.env.FEISHU_MODE === "webhook" && process.env.FEISHU_PUSH_ALERTS !== "0") {
      const { getFeishu, startAlertPusher, startDigest } = await import("./lib/bot");
      startAlertPusher(getFeishu(), process.env.APP_PUBLIC_URL || "http://localhost:3111");
      startDigest(getFeishu(), process.env.APP_PUBLIC_URL || "http://localhost:3111");
    }
  }
}
