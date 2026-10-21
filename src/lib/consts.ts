// 客户端安全的常量（不要在这里 import 任何服务端模块）
export const PLATFORM_NAME: Record<string, string> = { douyin: "抖音", xiaohongshu: "小红书", kuaishou: "快手", bilibili: "B站" };
export const PLATFORM_LIST = Object.entries(PLATFORM_NAME).map(([id, name]) => ({ id, name }));
export const TIER_LABEL: Record<string, string> = { head: "头部", waist: "腰部", tail: "尾部", micro: "素人", unknown: "未知" };
export const TIER_COLOR: Record<string, string> = { head: "#ff4d4d", waist: "#f5b83d", tail: "#2fd4a0", micro: "#579df8", unknown: "#8a8f98" };
export const TASK_STATUS: Record<string, string> = {
  pending: "排队中", running: "抓取中", done: "已完成", failed: "失败", cancelled: "已取消",
  paused_budget: "预算用尽", paused_circuit: "已熔断", interrupted: "已中断",
};
export const ACCOUNT_STATUS: Record<string, string> = { none: "未处理", watch: "重点关注", contacted: "已联系", excluded: "已排除" };
export const SOURCE_LABEL: Record<string, string> = { manual: "手动", schedule: "定时", rerun: "重跑" };
