"""Audit downloaded songs: compare requested (title, artists) against matched.

Reads logs/success.json (and logs/failed.json) and produces logs/match_report.md
with mismatches listed prominently for human review.

Two layers of verification:
1. success.json's "match" field -> what ytmusicapi told us we picked.
2. (optional) the .opus file's embedded Vorbis Comments -> what's on disk.

Currently uses #1 by default; #2 kicks in when --strict is passed and mutagen
finds a different title/artist than success.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import re
import config
from downloader import _norm


# ----- classifiers -----------------------------------------------------------

# YT Music often appends decorations to the title, e.g.
#   "出卖 - Betray", "爱错 - Wrong Love" (Chinese ' - Romanized')
#   "Beautiful World (2024 Mix)", "Star Crossing Night (feat. GALI)"
# Strip these before computing similarity so we don't punish romanization.
_PARENS_RE = re.compile(r"[\(（\[【].*?[\)）\]】]")
_DASH_SPLIT_RE = re.compile(r"\s+[-–—]\s+")

# Heuristics for detecting medleys / megamixes — these contain the requested
# title as a substring but are NOT the same recording.
_MEDLEY_KEYWORD_RE = re.compile(
    r"(medley|mix\b|组曲|組曲|串烧|串燒|連環炮|连环炮)",
    re.IGNORECASE,
)


def _looks_like_medley(title: str) -> bool:
    """Return True if the title looks like a list of multiple songs."""
    if not title:
        return False
    if _MEDLEY_KEYWORD_RE.search(title):
        return True
    # Two or more '/' separators outside any parenthetical -> song list.
    bare = _PARENS_RE.sub("", title)
    if bare.count("/") >= 2:
        return True
    if title.count("/") >= 3:
        return True
    return False


def _is_substring_match(requested: str, matched: str) -> bool:
    """True if the normalized requested title is a substring of matched
    (after stripping decorations from both)."""
    candidates_a = {_norm(requested), _norm(_strip_yt_decorations(requested))}
    candidates_b = {_norm(matched), _norm(_strip_yt_decorations(matched))}
    for a in candidates_a:
        if not a or len(a) < 2:
            continue
        for b in candidates_b:
            if not b:
                continue
            if a in b or b in a:
                return True
    return False


def _strip_yt_decorations(title: str) -> str:
    if not title:
        return ""
    # Remove parenthetical suffixes (half/full-width, square brackets).
    t = _PARENS_RE.sub("", title)
    # Drop a trailing " - {anything}" (commonly romanization or subtitle).
    parts = _DASH_SPLIT_RE.split(t, maxsplit=1)
    t = parts[0]
    return t.strip()


def title_similarity(requested: str, matched: str) -> float:
    """Best-effort similarity, robust to YT's title decorations.

    Strips parenthetical/bracket annotations and the ' - Romanization' suffix
    from BOTH sides, then takes the max SequenceMatcher ratio across the
    raw and stripped forms.

    Deliberately does NOT credit "request is substring of matched" with a
    high score — that misfires on medleys / megamixes whose title happens to
    contain the requested song's name among many others.
    """
    a_candidates: set[str] = set()
    b_candidates: set[str] = set()
    for s in (requested, _strip_yt_decorations(requested)):
        n = _norm(s)
        if n:
            a_candidates.add(n)
    for s in (matched, _strip_yt_decorations(matched)):
        n = _norm(s)
        if n:
            b_candidates.add(n)
    if not a_candidates or not b_candidates:
        return 0.0
    best = 0.0
    for a in a_candidates:
        for b in b_candidates:
            ratio = SequenceMatcher(None, a, b).ratio()
            if ratio > best:
                best = ratio
    return best


def artist_match(requested: list[str], matched: list[str]) -> str:
    """Return 'exact' | 'partial' | 'none' | 'no_requested' | 'no_matched'."""
    if not requested:
        return "no_requested"
    if not matched:
        return "no_matched"
    nreq = [_norm(a) for a in requested if a]
    nmat = [_norm(a) for a in matched if a]
    if not nreq:
        return "no_requested"
    if not nmat:
        return "no_matched"

    # Strong: full inclusion either direction
    for ra in nreq:
        for ma in nmat:
            if ra and ma and (ra in ma or ma in ra):
                return "exact"
    # Weak: any character overlap (very loose, rare case)
    for ra in nreq:
        for ma in nmat:
            if ra and ma and set(ra) & set(ma):
                return "partial"
    return "none"


CLASSES = [
    "mismatch",
    "warn_alias_likely",
    "warn_title_diff",
    "warn_no_artist",
    "warn_partial_artist",
    "warn_title_only",
    "ok_no_artist",
    "ok",
]
CLASS_EMOJI = {
    "mismatch": "❌",
    "warn_alias_likely": "🔵",
    "warn_title_diff": "⚠️",
    "warn_no_artist": "⚠️",
    "warn_partial_artist": "⚠️",
    "warn_title_only": "⚠️",
    "ok_no_artist": "🟡",
    "ok": "✅",
}


# Title-sim threshold above which a (title-match, artist-mismatch) pair is
# treated as a likely alias / romanization difference instead of a hard miss.
ALIAS_LIKELY_SIM = 0.92


def classify(
    title_sim: float,
    astat: str,
    requested_title: str = "",
    matched_title: str = "",
) -> str:
    if astat == "no_requested":
        # Requested had no artist field; we can only judge by title.
        if title_sim >= 0.7:
            return "ok_no_artist"
        return "warn_title_only"
    if astat == "no_matched":
        return "warn_no_artist"
    if astat == "exact":
        if title_sim >= 0.55:
            return "ok"
        # Low sim but artist matches. Two sub-cases:
        #  - Matched title is a medley containing the request -> real mismatch
        #  - Matched title contains the request as a substring (bilingual,
        #    "20th anniv" version, "女声版", etc.) -> likely the same song
        if (
            _is_substring_match(requested_title, matched_title)
            and not _looks_like_medley(matched_title)
        ):
            return "warn_alias_likely"
        return "warn_title_diff"
    if astat == "partial":
        return "warn_partial_artist"
    # astat == "none": artist completely differs.
    # If title is near-identical, it's likely an alias (e.g. 米津玄师 -> Kenshi Yonezu).
    if title_sim >= ALIAS_LIKELY_SIM:
        return "warn_alias_likely"
    # Title also differs but the request appears as a substring of matched
    # (and matched isn't a medley) -> probably the same song under a longer title
    # by a different/alias artist.
    if (
        _is_substring_match(requested_title, matched_title)
        and not _looks_like_medley(matched_title)
    ):
        return "warn_alias_likely"
    return "mismatch"


# ----- disk metadata (strict mode) ------------------------------------------

def read_file_meta(path: Path) -> dict | None:
    try:
        if path.suffix.lower() == ".opus":
            from mutagen.oggopus import OggOpus
            f = OggOpus(path)
            return {
                "title": (f.get("title") or [None])[0],
                "artist": (f.get("artist") or [None])[0],
                "album": (f.get("album") or [None])[0],
                "duration": getattr(f.info, "length", None),
            }
        if path.suffix.lower() in (".m4a", ".mp4"):
            from mutagen.mp4 import MP4
            f = MP4(path)
            t = f.tags or {}
            return {
                "title": (t.get("\xa9nam") or [None])[0],
                "artist": (t.get("\xa9ART") or [None])[0],
                "album": (t.get("\xa9alb") or [None])[0],
                "duration": getattr(f.info, "length", None),
            }
    except Exception:
        return None
    return None


# ----- main ------------------------------------------------------------------

def build_rows(success: dict, failed: dict, check_files: bool) -> list[dict]:
    rows: list[dict] = []
    for raw, entry in success.items():
        song = entry.get("song", {})
        match = entry.get("match", {})
        req_title = song.get("title", "") or ""
        req_artists = song.get("artists", []) or []
        mat_title = match.get("title", "") or ""
        mat_artists = match.get("artists", []) or []
        sim = title_similarity(req_title, mat_title)
        astat = artist_match(req_artists, mat_artists)
        cls = classify(sim, astat, req_title, mat_title)

        filepath = (entry.get("download") or {}).get("filepath") or ""
        exists = bool(filepath and Path(filepath).exists())
        disk_meta = None
        if check_files and exists:
            disk_meta = read_file_meta(Path(filepath))

        rows.append({
            "status": "downloaded",
            "raw": raw,
            "req_title": req_title,
            "req_artists": req_artists,
            "mat_title": mat_title,
            "mat_artists": mat_artists,
            "video_id": match.get("videoId"),
            "duration": match.get("duration"),
            "sim": sim,
            "astat": astat,
            "cls": cls,
            "filepath": filepath,
            "exists": exists,
            "disk_meta": disk_meta,
        })

    for raw, entry in failed.items():
        rows.append({
            "status": "failed",
            "raw": raw,
            "reason": entry.get("reason"),
            "cls": "failed",
        })

    return rows


def make_report(rows: list[dict]) -> str:
    downloaded = [r for r in rows if r["status"] == "downloaded"]
    failed = [r for r in rows if r["status"] == "failed"]
    cnts = Counter(r["cls"] for r in downloaded)

    out: list[str] = []
    out.append("# 下载匹配检查报告")
    out.append("")
    out.append(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    out.append("")

    out.append("## 总览")
    out.append("")
    out.append(f"- 下载成功(success.json): **{len(downloaded)}**")
    out.append(f"- 下载失败(failed.json): **{len(failed)}**")
    for c in CLASSES:
        n = cnts.get(c, 0)
        if n:
            out.append(f"  - {CLASS_EMOJI[c]} `{c}`: {n}")
    out.append("")

    legend = """
**分级说明**

| 标签 | 含义 |
|---|---|
| ✅ `ok` | 艺人对得上 + 标题相似度 ≥0.55 |
| 🟡 `ok_no_artist` | 歌单原始就没有艺人字段,但标题对得上(≥0.7),只能这么放过 |
| 🔵 `warn_alias_likely` | 艺人字面对不上**但标题完全一致**(≥0.92),多半是罗马音/艺名差异(如 米津玄师↔Kenshi Yonezu、蔡徐坤↔KUN) |
| ⚠️ `warn_title_diff` | 艺人对但标题差异大(可能 remix/合辑别名) |
| ⚠️ `warn_partial_artist` | 艺人字符有交集但不完全包含 |
| ⚠️ `warn_no_artist` | YT 返回的艺人是空 |
| ⚠️ `warn_title_only` | 歌单缺艺人 + 标题也对不太上 |
| ❌ `mismatch` | **艺人不同 + 标题也明显不同,需要人工 review/重下** |
"""
    out.append(legend.strip())
    out.append("")

    # MISMATCH (red flags)
    mismatches = [r for r in downloaded if r["cls"] == "mismatch"]
    if mismatches:
        out.append(f"## ❌ 不匹配(共 {len(mismatches)} 条,**优先 review**)")
        out.append("")
        for r in mismatches:
            out.append(f"### `{r['raw']}`")
            out.append("")
            out.append(f"- 请求: 标题=`{r['req_title']}`  艺人=`{r['req_artists']}`")
            out.append(f"- 实际: 标题=`{r['mat_title']}`  艺人=`{r['mat_artists']}`")
            out.append(f"- videoId=`{r['video_id']}` · 时长=`{r['duration']}` · 标题相似度=`{r['sim']:.2f}`")
            out.append(f"- 文件: `{r['filepath']}` · 存在={r['exists']}")
            if r.get("disk_meta"):
                dm = r["disk_meta"]
                out.append(f"- 磁盘 metadata: 标题=`{dm.get('title')}` 艺人=`{dm.get('artist')}` 时长=`{dm.get('duration'):.1f}s`")
            out.append("")

    # Warnings buckets
    bucket_titles = {
        "warn_alias_likely": "🔵 艺人字面不同但标题完全一致(疑似罗马音/艺名/简繁差异)",
        "warn_title_diff": "⚠️ 艺人对但标题差异大",
        "warn_partial_artist": "⚠️ 艺人字符仅部分相交",
        "warn_no_artist": "⚠️ YT 返回的艺人为空",
        "warn_title_only": "⚠️ 歌单缺艺人且标题相似度低",
    }
    for cls_key, header in bucket_titles.items():
        bucket = [r for r in downloaded if r["cls"] == cls_key]
        if not bucket:
            continue
        out.append(f"## {header} (共 {len(bucket)} 条)")
        out.append("")
        for r in bucket:
            out.append(f"- **`{r['raw']}`** → `{r['mat_title']}` by `{r['mat_artists']}` (sim={r['sim']:.2f}, videoId=`{r['video_id']}`)")
        out.append("")

    # Failed downloads
    if failed:
        out.append(f"## 💥 下载失败 (共 {len(failed)} 条)")
        out.append("")
        for r in failed:
            out.append(f"- `{r['raw']}` — 原因: `{r['reason']}`")
        out.append("")

    # OK list (compact, collapsed)
    ok = [r for r in downloaded if r["cls"] in ("ok", "ok_no_artist")]
    out.append(f"## ✅ 看起来正确 (共 {len(ok)} 条)")
    out.append("")
    out.append("<details><summary>展开</summary>")
    out.append("")
    for r in ok:
        emoji = CLASS_EMOJI[r["cls"]]
        out.append(f"- {emoji} `{r['raw']}` → `{r['mat_title']}` | `{r['mat_artists']}` (sim={r['sim']:.2f})")
    out.append("")
    out.append("</details>")

    return "\n".join(out) + "\n"


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--check-files", action="store_true",
                   help="Also read embedded metadata from .opus/.m4a (slower)")
    p.add_argument("-o", "--out", default=str(config.LOGS_DIR / "match_report.md"),
                   help="Output markdown file path")
    args = p.parse_args(argv)

    success_path = config.SUCCESS_LOG
    failed_path = config.FAILED_LOG

    success = json.loads(success_path.read_text(encoding="utf-8")) if success_path.exists() else {}
    failed = json.loads(failed_path.read_text(encoding="utf-8")) if failed_path.exists() else {}

    rows = build_rows(success, failed, check_files=args.check_files)
    report = make_report(rows)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")

    cnts = Counter(r["cls"] for r in rows if r["status"] == "downloaded")
    print(f"Report: {out_path}")
    print(f"Summary: total={sum(cnts.values())}  " +
          " ".join(f"{CLASS_EMOJI.get(k,'')}{k}={v}" for k, v in cnts.most_common()))
    if cnts.get("mismatch", 0):
        print(f"\n⚠️  Found {cnts['mismatch']} mismatches — review the top of the report first.")


if __name__ == "__main__":
    main()
