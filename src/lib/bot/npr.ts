import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const EXEC_FILE = promisify(execFile);
const PR_URL = /^https:\/\/github\.com\/([a-z0-9-]+\/[a-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/i;

type Env = Record<string, string | undefined>;
export type NprRunner = (executable: string, prUrl: string) => Promise<void>;

/** 直接执行本机配置的工具，链接作为独立参数传入。 */
export async function runLocalNpr(executable: string, prUrl: string): Promise<void> {
  await EXEC_FILE(executable, [prUrl], { timeout: 60_000, maxBuffer: 128 * 1024, windowsHide: true });
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
  try {
    await run(executable, `https://github.com/${repo}/pull/${number}`);
    return `npr 执行成功。PR ${repo} #${number}`;
  } catch {
    return `npr 执行失败或超时。请在 GitHub 核对 ${repo} #${number} 的审批状态，并检查本机 npr 配置。`;
  }
}
