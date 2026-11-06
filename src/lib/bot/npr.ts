import { execFile } from "node:child_process";
import { isAbsolute, win32 } from "node:path";
import { promisify } from "node:util";

const EXEC_FILE = promisify(execFile);
const PR_URL = /^https:\/\/github\.com\/([a-z0-9-]+\/[a-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/i;

type Env = Record<string, string | undefined>;
export type NprRunner = (executable: string, prUrl: string) => Promise<void>;

/** 执行本机配置的工具，Windows 批处理入口交给系统 cmd。 */
export async function runLocalNpr(executable: string, prUrl: string): Promise<void> {
  const options = { timeout: 60_000, maxBuffer: 128 * 1024, windowsHide: true };
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    // cmd 会展开变量，即使路径有引号也需要拒绝这些字符。
    if (!win32.isAbsolute(executable) || /[%!"\r\n\0]/.test(executable) || !PR_URL.test(prUrl)) {
      throw Object.assign(new Error("Windows 批处理路径或 PR 链接无效"), { code: "NPR_INVALID_BATCH_ARGUMENT" });
    }
    const cmd = win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    await EXEC_FILE(cmd, ["/d", "/v:off", "/s", "/c", `""${executable}" "${prUrl}""`], {
      ...options,
      windowsVerbatimArguments: true,
    });
    return;
  }
  await EXEC_FILE(executable, [prUrl], options);
}

/** 只返回安全的错误分类，避免把子进程的输出转发到飞书。 */
function describeNprFailure(error: unknown): string {
  if (!(error instanceof Error)) return "npr 执行失败。";
  const failure = error as Error & { code?: string | number; killed?: boolean; signal?: string };
  if (failure.code === "NPR_INVALID_BATCH_ARGUMENT") return "Windows 批处理路径或 PR 链接无效。请检查 npr.cmd 路径。";
  if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "npr 输出超过限制。";
  if (failure.killed && failure.signal === "SIGTERM") return "npr 执行超过 60 秒。请确认工具可以无交互运行。";
  if (failure.code === "ENOENT") return "找不到 npr 可执行文件或它依赖的解释器。请核对机器人所在电脑的路径。";
  if (failure.code === "EACCES" || failure.code === "EPERM") return "机器人进程没有权限执行 npr。";
  if (typeof failure.code === "number") {
    return `npr 返回退出码 ${failure.code}。请在运行机器人的电脑上用同一账号运行该命令，查看工具的报错。`;
  }
  return "npr 无法启动或异常退出。请检查本机工具配置。";
}

/** 校验命令、发送者和仓库，向飞书返回执行结果。 */
export async function handleNpr(
  text: string, userId: string, isPrivate: boolean, env: Env, run?: NprRunner,
): Promise<string> {
  const executable = env.FEISHU_NPR_EXECUTABLE?.trim();
  if (!run || !executable || !isAbsolute(executable)) return "PR 审批需要配置本机长连接和 npr 可执行文件的绝对路径。";
  if (!isPrivate || !env.FEISHU_NPR_OPEN_IDS?.split(/[,\s]+/).includes(userId)) {
    return "PR 审批仅限获授权的用户私聊机器人使用。";
  }
  const match = PR_URL.exec(text.replace(/^npr\s+/i, ""));
  if (!match) return "用法：npr https://github.com/OWNER/REPO/pull/123";
  const [, repo, number] = match;
  if (!env.FEISHU_NPR_REPOS?.toLowerCase().split(/[,\s]+/).includes(repo.toLowerCase())) {
    return "该仓库未开放飞书 PR 审批。";
  }
  if (process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(executable)) {
    return "Windows 请配置 npr.cmd 或 npr.exe 的完整路径。";
  }
  try {
    await run(executable, `https://github.com/${repo}/pull/${number}`);
    return `npr 执行成功。PR ${repo} #${number}`;
  } catch (error) {
    return `${describeNprFailure(error)} 请在 GitHub 核对 ${repo} #${number} 的审批状态。`;
  }
}
