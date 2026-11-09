/** 默认开放查看，旧的本机管理员配置升级后也使用免登录查看。 */
export function allowsAnonymousRead(): boolean {
  const mode = process.env.WEB_AUTH_MODE?.trim();
  return !mode || mode === "public" || mode === "local_admin";
}
