import Link from "next/link";
import { cookies } from "next/headers";
import { LOCAL_ADMIN_COOKIE, LOCAL_ADMIN_NAME, localAdminExpiry } from "@/lib/auth/local-admin";
import styles from "../login/login.module.css";

/** 本地管理员登录入口。 */
export default async function LocalAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const active = localAdminExpiry((await cookies()).get(LOCAL_ADMIN_COOKIE)?.value);
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="local-title">
        <header className={styles.brand}>
          <div><h1 id="local-title" className={styles.title}>本地管理员</h1>
            <p className={styles.subtitle}>用于本机调试的备用登录入口。</p></div>
        </header>
        {error && <p role="alert" className={styles.notice}>{error === "rate" ? "尝试次数过多，请一分钟后重试。" : "账号或密码不正确，或凭证已过期。"}</p>}
        {active ? (
          <nav className={styles.form}><Link href="/">进入控制台</Link><Link href="/local-admin/reset">重置管理员密码</Link></nav>
        ) : (
          <form className={styles.form} action="/api/auth/local-admin" method="post">
            <label className={styles.field}>账号<input name="username" defaultValue={LOCAL_ADMIN_NAME} autoComplete="username" required /></label>
            <label className={styles.field}>密码<input name="password" type="password" autoComplete="current-password" required /></label>
            <button className={`btn primary ${styles.submit}`} type="submit">登录控制台</button>
            <Link href="/login">返回 HOE 登录</Link>
          </form>
        )}
      </section>
    </main>
  );
}
