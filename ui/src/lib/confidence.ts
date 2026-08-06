/**
 * 置信度评估(D-10/D-11 的核心)。
 *
 * pickBest 选出"最优候选",confidence 评判"这个最优够不够可信"。
 * 两者都基于同一打分,但 confidence 额外考虑黑名单/降权词命中、艺人严重不匹配,
 * 输出三档置信度 + 人类可读的存疑原因。
 *
 * 这是 D 页"质量标注 + 二次确认"的判定依据。
 */
import { artistMatch } from "./checkMatches";
import { titleSimilarity, looksLikeMedley } from "./similarity";
import type { ScoredCandidate } from "./pickBest";
import type { SearchResult } from "./pickBest";

export type Confidence = "high" | "medium" | "low";

export interface ConfidenceReport {
  confidence: Confidence;
  /** 存疑原因(高置信度为 null) */
  reason: string | null;
  /** 命中的存疑标签(用于 UI 标注) */
  flags: string[];
}

/** yt-dlp ytsearch 的 uploader 常见的"非正版"特征词。 */
const NON_CATALOG_UPLOADER = /(cover|covers|lyric|lyrics|fan|reaction|karaoke|topic-?)/i;

/**
 * 评估一个打分候选的置信度。
 *
 * @param best      pickBest 选出的最高分候选
 * @param reqTitle  请求的标题
 * @param reqArtists 请求的艺人
 * @param skipKeywords 标题黑名单(用于检测命中)
 * @param deprioritizeKeywords 降权词
 */
export function assessConfidence(
  best: SearchResult,
  reqTitle: string,
  reqArtists: string[],
  skipKeywords: string[],
  deprioritizeKeywords: string[],
): ConfidenceReport {
  const flags: string[] = [];
  const reasons: string[] = [];
  const titleLow = (best.title || "").toLowerCase();
  const uploaderLow = (best.uploader || "").toLowerCase();

  // 1. medley / 串烧(强失败信号)
  if (looksLikeMedley(best.title)) {
    flags.push("Medley");
    reasons.push("命中 medley/串烧,不是单曲版本");
  }

  // 2. 命中标题黑名单(强失败:karaoke/伴奏/翻唱 等)
  const hitSkip = skipKeywords
    .map((k) => k.toLowerCase())
    .filter((k) => titleLow.includes(k));
  if (hitSkip.length > 0) {
    flags.push(...hitSkip);
    reasons.push(`标题含黑名单词:${hitSkip.join("/")}`);
  }

  // 3. MV / Live / Remix / cover 等版本词(降权词命中)
  const hitDepr = deprioritizeKeywords
    .map((k) => k.toLowerCase())
    .filter((k) => titleLow.includes(k));
  if (hitDepr.length > 0) {
    flags.push(...hitDepr.map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase())));
    reasons.push(`疑似非录音室版本:${hitDepr.join("/")}`);
  }

  // 4. uploader 像非正版源(用户上传歌词/翻唱频道)
  if (uploaderLow && NON_CATALOG_UPLOADER.test(uploaderLow)) {
    flags.push("非正版频道");
    reasons.push(`上传者「${best.uploader}」疑似用户/翻唱频道`);
  }

  // 5. 艺人匹配
  const astat = artistMatch(
    reqArtists,
    best.uploader ? [best.uploader] : [],
  );
  // 注:yt-dlp ytsearch 的 uploader 不是干净艺人字段,这里只对"完全无交集"判弱
  if (astat === "none" && reqArtists.length > 0 && best.uploader) {
    flags.push("艺人不符");
    reasons.push(`请求艺人「${reqArtists.join("/")}」与「${best.uploader}」无交集`);
  }

  // 6. 标题相似度
  const sim = titleSimilarity(reqTitle, best.title);

  // 综合定档
  const strongFail = flags.includes("Medley") || hitSkip.length > 0;
  let confidence: Confidence;
  if (strongFail) {
    confidence = "low";
  } else if (flags.length === 0 && sim >= 0.7 && astat !== "none") {
    confidence = "high";
  } else if (sim < 0.55 || flags.length >= 2) {
    confidence = "low";
  } else {
    confidence = "medium";
  }

  return {
    confidence,
    reason: reasons.length > 0 ? reasons.join(";") : null,
    flags,
  };
}

/** 置信度对应的 UI 标签颜色 key。 */
export function confidenceColor(c: Confidence): "ok" | "warn" | "err" {
  return c === "high" ? "ok" : c === "medium" ? "warn" : "err";
}

/** 置信度中文标签。 */
export function confidenceLabel(c: Confidence): string {
  return c === "high" ? "高" : c === "medium" ? "中" : "低";
}

/** 取最优候选 + 置信度报告(组合 pickBest 和 assessConfidence)。 */
export function bestWithConfidence(
  scored: ScoredCandidate[],
  reqTitle: string,
  reqArtists: string[],
  skipKeywords: string[],
  deprioritizeKeywords: string[],
): { best: SearchResult | null; report: ConfidenceReport | null } {
  const best = scored[0]?.result ?? null;
  if (!best) return { best: null, report: null };
  return {
    best,
    report: assessConfidence(
      best,
      reqTitle,
      reqArtists,
      skipKeywords,
      deprioritizeKeywords,
    ),
  };
}
