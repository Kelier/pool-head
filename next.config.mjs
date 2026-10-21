// NEXT_DIST_DIR 允许多个 dev 实例并行（各用独立缓存目录）
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false, // 关闭开发模式左下角角标，避免遮挡侧边栏图标
};
export default nextConfig;
