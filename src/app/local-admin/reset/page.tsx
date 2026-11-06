import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCAL_ADMIN_COOKIE, localAdminExpiry } from "@/lib/auth/local-admin";
import styles from "../../login/login.module.css";

/** 登录后重置管理员密码并重新开始七天有效期。 */
export default async function LocalAdminResetPage({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const expiresAt = localAdminExpiry((await cookies()).get(LOCAL_ADMIN_COOKIE)?.value);
  if (!expiresAt) redirect("/local-admin");
  const { error, updated } = await searchParams;
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="reset-title">
        <header className={styles.brand}>
          <div><h1 id="reset-title" className={styles.title}>重置管理员密码</h1>
            <p className={styles.subtitle}>当前到期时间 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(expiresAt)}</p></div>
        </header>
        {updated && <p role="status" className={styles.notice}>已重置，新的有效期为 7 天。</p>}
        {error && <p role="alert" className={styles.notice}>请输入两次相同的密码，长度 12 至 128 个字符。</p>}
        <form className={styles.form} action="/api/auth/local-admin" method="post">
          <input type="hidden" name="action" value="reset" />
          <label className={styles.field}>新密码<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
          <label className={styles.field}>确认密码<input name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
          <button className={`btn primary ${styles.submit}`} type="submit">保存新密码</button>
          <Link href="/">返回控制台</Link>
        </form>
      </section>
    </main>
  );
}
