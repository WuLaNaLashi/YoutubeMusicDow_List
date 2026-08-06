/**
 * 匹配分类。移植自 `src/check_matches.py`。
 *
 * 把"请求的(title, artists)"和"实际匹配的(title, artists)"按规则归类成 8 级。
 * 这是工具的"质量闸",搜索下错的歌会在这里被暴露。
 */
import { normalize } from "./opencc";
import { isSubstringMatch, looksLikeMedley } from "./similarity";

export type Class =
  | "mismatch"
  | "warn_alias_likely"
  | "warn_title_diff"
  | "warn_no_artist"
  | "warn_partial_artist"
  | "warn_title_only"
  | "ok_no_artist"
  | "ok";

export const CLASS_EMOJI: Record<Class, string> = {
  mismatch: "❌",
  warn_alias_likely: "🔵",
  warn_title_diff: "⚠️",
  warn_no_artist: "⚠️",
  warn_partial_artist: "⚠️",
  warn_title_only: "⚠️",
  ok_no_artist: "🟡",
  ok: "✅",
};

export type ArtistState =
  | "exact"
  | "partial"
  | "none"
  | "no_requested"
  | "no_matched";

const ALIAS_LIKELY_SIM = 0.92;

/** 艺人匹配:exact/partial/none/no_requested/no_matched。对应 `check_matches.artist_match`。 */
export function artistMatch(
  requested: string[],
  matched: string[],
): ArtistState {
  if (!requested.length) return "no_requested";
  if (!matched.length) return "no_matched";
  const nreq = requested.map(normalize).filter(Boolean);
  const nmat = matched.map(normalize).filter(Boolean);
  if (!nreq.length) return "no_requested";
  if (!nmat.length) return "no_matched";

  // 强:双向完整包含
  for (const ra of nreq) {
    for (const ma of nmat) {
      if (ra && ma && (ra.includes(ma) || ma.includes(ra))) return "exact";
    }
  }
  // 弱:任意字符交集
  for (const ra of nreq) {
    for (const ma of nmat) {
      if (ra && ma && [...ra].some((c) => ma.includes(c))) return "partial";
    }
  }
  return "none";
}

/** 8 级分类。对应 `check_matches.classify`。 */
export function classify(
  titleSim: number,
  astat: ArtistState,
  requestedTitle = "",
  matchedTitle = "",
): Class {
  if (astat === "no_requested") {
    return titleSim >= 0.7 ? "ok_no_artist" : "warn_title_only";
  }
  if (astat === "no_matched") return "warn_no_artist";
  if (astat === "exact") {
    if (titleSim >= 0.55) return "ok";
    if (
      isSubstringMatch(requestedTitle, matchedTitle) &&
      !looksLikeMedley(matchedTitle)
    ) {
      return "warn_alias_likely";
    }
    return "warn_title_diff";
  }
  if (astat === "partial") return "warn_partial_artist";
  // astat === "none":艺人完全不同
  if (titleSim >= ALIAS_LIKELY_SIM) return "warn_alias_likely";
  if (
    isSubstringMatch(requestedTitle, matchedTitle) &&
    !looksLikeMedley(matchedTitle)
  ) {
    return "warn_alias_likely";
  }
  return "mismatch";
}
