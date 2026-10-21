/** 品牌标：雷达/准星 + 信号弧。黑底圆角方块 + 品牌粉，与 OiiOii 的黑粉配色一致。 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="投放监测">
      <rect width="32" height="32" rx="9" fill="#111213" />
      <circle cx="15" cy="17" r="7.2" fill="none" stroke="#ff1eb4" strokeWidth="3.2" />
      <circle cx="15" cy="17" r="2.6" fill="#ff1eb4" />
      <path d="M22.2 9.2a8.6 8.6 0 0 1 3.4 3.5" stroke="#ff6cc2" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M21.4 4.8a13 13 0 0 1 6 6" stroke="#ff6cc2" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".55" />
    </svg>
  );
}
