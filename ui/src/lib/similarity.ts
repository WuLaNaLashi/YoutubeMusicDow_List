/**
 * 字符串相似度 + medley 检测。移植自 `src/check_matches.py`。
 * 这是工具的"大脑"之一,被 checkMatches 和 pickBest 共用。
 */
import { normalize } from "./opencc";

/** 剥离括号注解 + 尾部 " - 罗马音/副标题"。 */
export function stripYtDecorations(title: string): string {
  if (!title) return "";
  const PARENS_RE = /[\(（\[【].*?[\)）\]】]/g;
  let t = title.replace(PARENS_RE, "");
  // 去掉尾部 " - {anything}"(常见罗马音/副标题)
  const parts = t.split(/\s+[-–—]\s+/);
  return (parts[0] ?? "").trim();
}

/**
 * SequenceMatcher 相似度。移植 Python difflib.SequenceMatcher.ratio()。
 * 用最长公共子序列长度近似(足够稳定,用于打分阈值判断)。
 *
 * 返回 0~1。
 */
export function sequenceMatcherRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  // DP 求最长公共子序列
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[m][n]) / (m + n);
}

/**
 * 标题相似度:对两边分别取"原始"和"剥装饰"两种形式,归一化后取最大 SequenceMatcher.ratio()。
 * 对应 Python `check_matches.title_similarity`。
 */
export function titleSimilarity(requested: string, matched: string): number {
  const aCandidates = new Set<string>();
  const bCandidates = new Set<string>();
  for (const s of [requested, stripYtDecorations(requested)]) {
    const n = normalize(s);
    if (n) aCandidates.add(n);
  }
  for (const s of [matched, stripYtDecorations(matched)]) {
    const n = normalize(s);
    if (n) bCandidates.add(n);
  }
  if (aCandidates.size === 0 || bCandidates.size === 0) return 0;

  let best = 0;
  for (const a of aCandidates) {
    for (const b of bCandidates) {
      const r = sequenceMatcherRatio(a, b);
      if (r > best) best = r;
    }
  }
  return best;
}

const MEDLEY_RE = /(medley|mix\b|组曲|組曲|串烧|串燒|連環炮|连环炮)/i;

/** 是否看起来像 medley/串烧(包含多首歌)。 */
export function looksLikeMedley(title: string): boolean {
  if (!title) return false;
  if (MEDLEY_RE.test(title)) return true;
  const PARENS_RE = /[\(（\[【].*?[\)）\]】]/g;
  const bare = title.replace(PARENS_RE, "");
  if ((bare.match(/\//g) ?? []).length >= 2) return true;
  if ((title.match(/\//g) ?? []).length >= 3) return true;
  return false;
}

/**
 * 请求标题是否为 matched 的子串(归一化后)。对应 `_is_substring_match`。
 * 用于"双语/版本"识别(标题含请求但更长,如 "20th anniv")。
 * 单字标题(len<2)跳过,避免误判。
 */
export function isSubstringMatch(requested: string, matched: string): boolean {
  const aCandidates = new Set([
    normalize(requested),
    normalize(stripYtDecorations(requested)),
  ]);
  const bCandidates = new Set([
    normalize(matched),
    normalize(stripYtDecorations(matched)),
  ]);
  for (const a of aCandidates) {
    if (!a || a.length < 2) continue;
    for (const b of bCandidates) {
      if (!b) continue;
      if (a.includes(b) || b.includes(a)) return true;
    }
  }
  return false;
}
