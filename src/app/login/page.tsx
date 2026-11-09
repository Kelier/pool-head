import { Logo } from "@/components/Logo";
import { usesHoeAuth } from "@/lib/auth/hoe";
import { returnPath } from "@/lib/auth/feishu";

import { HoeForm } from "./hoe-form";
import styles from "./login.module.css";

const ERROR_TEXT: Record<string, string> = {
  authorization: "飞书授权未完成或已过期，请重新登录。",
  tenant: "当前飞书组织未获准访问，请联系管理员。",
  credentials: "HOE 拒绝了本次登录。请确认使用的是 HOE 测试环境的账号和密码。",
  confirmEmail: "HOE 账号的邮箱还未确认，请在 Hogi 完成邮箱验证后重试。",
  captcha: "人机验证未通过，请完成页面上的验证后重试。",
  access: "该 HOE 账号还没有竞品平台访问权限。",
  hogi: "Hogi 登录服务暂不可用，请稍后重试。",
  session: "Hogi 已返回登录结果，但 HOE 暂时无法建立会话。",
  accessService: "账号已通过验证，但 HOE 访问名单服务暂不可用，请联系管理员。",
  approvalService: "飞书审批暂不可用。请联系管理员检查飞书应用配置。",
  approvalDirectory: "飞书通讯录查询失败，请管理员检查应用的通讯录权限和可见范围。",
  approvalBinding: "此 HOE 账号尚未登记竞品平台权限或绑定飞书身份。",
  approvalIdentity: "审批已失效，或当前飞书账号与登录账号的绑定不匹配。",
  service: "登录暂时失败，请重试或联系管理员。",
};

/** 按环境展示 HOE 或飞书登录入口。 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; approval?: string }> }) {
  const { next, error, approval } = await searchParams;
  const hoe = usesHoeAuth();
  const notice = approval === "expired" ? "审批已过期，请重新登录。"
    : error && Object.hasOwn(ERROR_TEXT, error) ? ERROR_TEXT[error] : null;

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <header className={styles.brand}>
          <Logo size={42} />
          <div>
            <h1 id="login-title" className={styles.title}>竞品投放监测</h1>
            <p className={styles.subtitle}>{hoe ? "使用 Hogi HOE 测试账号登录" : "使用飞书账号登录控制台"}</p>
          </div>
        </header>
        {notice && <p className={styles.notice} role="alert">{notice}</p>}
        {approval === "pending" ? (
          <form action="/api/auth/hoe/approval" method="post" className={styles.form}>
            <p className={styles.subtitle}>请在飞书私信里完成本次授权，随后回到这个浏览器继续登录。授权链接 10 分钟内有效。</p>
            <button type="submit" className={`btn primary ${styles.submit}`}>我已授权，继续登录</button>
          </form>
        ) : approval === "confirmed" ? (
          <p role="status">已批准本次登录。请回到发起登录的浏览器继续。</p>
        ) : hoe ? (
          <HoeForm next={returnPath(next)} />
        ) : (
          <a className={`btn primary ${styles.submit}`} href={`/api/auth/login?next=${encodeURIComponent(returnPath(next))}`}>使用飞书登录</a>
        )}
      </section>
    </main>
  );
}
