/**
 * 候选筛选打分。移植自 `src/downloader.py:pick_best`。
 *
 * 流程:黑名单过滤 → 时长过滤 → 标题子串匹配加分(+20)
 *      → 艺人匹配加分(+10) → song 类型加分(+5) → live/acoustic 降权(-15) → 取最高分。
 */
import { normalize } from "./opencc";

export interface SearchResult {
  /** videoId 或 yt-dlp 的 id */
  id: string;
  title: string;
  /** 频道/上传者(yt-dlp ytsearch 给的是 uploader) */
  uploader?: string;
  /** 秒 */
  duration?: number;
  /** "song" | "video"(ytmusicapi 才有, yt-dlp 默认 video) */
  resultType?: string;
  /** 浏览量(yt-dlp ytsearch 给) */
  viewCount?: number;
}

export interface ScoredCandidate {
  result: SearchResult;
  score: number;
  /** 被过滤的原因(若被过滤) */
  filteredReason?: string;
}

export interface PickBestOptions {
  skipKeywords: string[];
  skipArtistKeywords: string[];
  deprioritizeKeywords: string[];
  deprioritizePenalty?: number;
  durationMinSec?: number;
  durationMaxSec?: number;
}

const DEFAULT_OPTS: Required<PickBestOptions> = {
  skipKeywords: [],
  skipArtistKeywords: [],
  deprioritizeKeywords: [],
  deprioritizePenalty: 15,
  durationMinSec: 30,
  durationMaxSec: 1200,
};

/** 对所有候选打分,返回按分数降序排列(被过滤的不返回)。 */
export function scoreAll(
  results: SearchResult[],
  title: string,
  artists: string[],
  opts: PickBestOptions,
): ScoredCandidate[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  const nt = normalize(title);
  const nArtists = artists.map(normalize);
  const skip = o.skipKeywords.map((k) => k.toLowerCase());
  const skipArtist = o.skipArtistKeywords.map((k) => k.toLowerCase());
  const depr = o.deprioritizeKeywords.map((k) => k.toLowerCase());

  const scored: ScoredCandidate[] = [];
  for (const r of results) {
    const titleLow = (r.title || "").toLowerCase();

    // 标题黑名单
    if (skip.some((k) => titleLow.includes(k))) continue;
    // 艺人/上传者黑名单
    const uploaderLow = (r.uploader || "").toLowerCase();
    if (uploaderLow && skipArtist.some((k) => uploaderLow.includes(k))) continue;
    // 时长范围
    if (
      r.duration != null &&
      (r.duration < o.durationMinSec || r.duration > o.durationMaxSec)
    )
      continue;

    let score = 0;
    const rn = normalize(r.title);
    if (nt && rn && (nt.includes(rn) || rn.includes(nt))) {
      score += 20;
    } else if (nt && rn) {
      // 字符交集(最多 +10)
      const common = new Set([...nt].filter((c) => rn.includes(c))).size;
      score += Math.min(common, 10);
    }

    for (const a of nArtists) {
      if (a && r.uploader && normalize(r.uploader).includes(a)) {
        score += 10;
        break;
      }
    }

    if (r.resultType === "song") score += 5;

    if (depr.some((k) => titleLow.includes(k))) score -= o.deprioritizePenalty;

    scored.push({ result: r, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** 取最高分候选(等价 Python `pick_best`)。 */
export function pickBest(
  results: SearchResult[],
  title: string,
  artists: string[],
  opts: PickBestOptions,
): SearchResult | null {
  const scored = scoreAll(results, title, artists, opts);
  return scored[0]?.result ?? null;
}
