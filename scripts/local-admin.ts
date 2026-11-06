import { randomBytes } from "node:crypto";
import { LOCAL_ADMIN_NAME, provisionLocalAdmin } from "../src/lib/auth/local-admin";

/** 在终端生成一次性的初始输出，SQLite 只写入密码哈希。 */
async function main() {
  const password = randomBytes(18).toString("base64url");
  const expiresAt = await provisionLocalAdmin(password);
  const expiry = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(expiresAt);
  console.log(`账号 ${LOCAL_ADMIN_NAME}\n密码 ${password}\n到期 ${expiry}（上海时间）`);
}

await main();
