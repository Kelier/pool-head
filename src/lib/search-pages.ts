export const ESTIMATED_SEARCH_CALLS = 100;
export const MAX_SEARCH_PAGES = Number.MAX_SAFE_INTEGER;

/** 将预算预估的搜索调用分摊到各组合，仅用于估价。 */
export function estimateSearchPages(platforms: number, keywords: number): number {
  return Math.ceil(ESTIMATED_SEARCH_CALLS / Math.max(1, platforms * keywords));
}
