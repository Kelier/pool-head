/** 显式启用免登录操作。 */
export function usesPublicWeb(): boolean {
  return process.env.WEB_AUTH_MODE?.trim() === "public";
}

/** 未设置模式或使用旧管理员配置时，保持免登录查看。 */
export function allowsAnonymousRead(): boolean {
  const mode = process.env.WEB_AUTH_MODE?.trim();
  return !mode || mode === "local_admin";
}
