"""Single-song download logic: search YT Music -> pick best -> download via yt-dlp."""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

import yt_dlp
from ytmusicapi import YTMusic

try:
    from opencc import OpenCC
    _opencc_t2s = OpenCC("t2s")  # Traditional -> Simplified
except Exception:
    _opencc_t2s = None

import config
import artist_alias

log = logging.getLogger(__name__)

_ytmusic: Optional[YTMusic] = None


def _get_ytmusic() -> YTMusic:
    global _ytmusic
    if _ytmusic is None:
        _ytmusic = YTMusic()
    return _ytmusic


_INVALID_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def sanitize_filename(s: str, max_len: int = 180) -> str:
    s = _INVALID_CHARS.sub("_", s)
    s = re.sub(r"\s+", " ", s).strip().strip(".")
    if not s:
        s = "untitled"
    return s[:max_len]


def _norm(s: str) -> str:
    """Lowercase, strip non-alphanumeric, and convert traditional Chinese to simplified."""
    if not s:
        return ""
    if _opencc_t2s is not None:
        s = _opencc_t2s.convert(s)
    return re.sub(r"[\s\W_]+", "", s.lower(), flags=re.UNICODE)


def search_song(title: str, artists: list[str], limit: int = 5) -> list[dict]:
    """Search YT Music; return raw result list. May raise on network issues."""
    ytm = _get_ytmusic()
    # query 用别名表的标准名(如 高耀太->KOYOTE),中文俗名直接搜容易把候选带偏
    query = " ".join([title] + [artist_alias.primary_name(a) for a in artists])
    log.debug("Search: %s", query)
    try:
        return ytm.search(query, filter="songs", limit=limit) or []
    except Exception as e:
        log.warning("ytmusicapi songs-search failed (%s); trying generic", e)
        try:
            results = ytm.search(query, limit=limit) or []
            return [r for r in results if r.get("resultType") in ("song", "video")]
        except Exception as e2:
            log.warning("ytmusicapi generic search also failed: %s", e2)
            return []


def search_artist_names(name: str, limit: int = 3) -> list[str]:
    """YTM 艺人搜索:返回候选标准艺名(供 artist_alias.bootstrap 反查)。"""
    ytm = _get_ytmusic()
    results = ytm.search(name, filter="artists", limit=limit) or []
    return [r.get("artist") or "" for r in results if r.get("artist")]


def pick_best(
    results: list[dict],
    title: str,
    artists: list[str],
    skip_keywords: list[str],
    dur_min: int,
    dur_max: int,
    deprioritize_keywords: list[str] | None = None,
    deprioritize_penalty: int = 15,
    skip_artist_keywords: list[str] | None = None,
) -> Optional[dict]:
    """打分规则(v2,2026-08-19 错配实测后调整):
    - 门槛:标题(子串或字符集>=2)与艺人(含别名展开)至少一个命中,否则整条丢弃;
      候选池没有正确答案时宁可返回 None(no_match_after_filter),不硬选错曲。
    - 标题子串 +15,字符集交集 +min(n,8);
    - 艺人命中 +10(查询名经 artist_alias 展开,跨语言标准名/谚文名均可命中);
    - 搜索位置 +max(0, 16-3*index):query 携带标准艺名时 YTM 相关性排序是强先验,
      让 불꽃-KOYOTE 这类"标题零交集但排第 1"的正确结果能胜过同名的错误版本。
    """
    if not results:
        return None

    nt = _norm(title)
    # 艺人匹配集合用别名展开(少女时代 -> [少女时代, Girls' Generation, ...])
    nartist_sets = [
        [_norm(v) for v in artist_alias.expand(a) if _norm(v)] for a in artists
    ]
    skip_norm = [k.lower() for k in skip_keywords]
    skip_artist_norm = [k.lower() for k in (skip_artist_keywords or [])]
    depr_norm = [k.lower() for k in (deprioritize_keywords or [])]

    scored: list[tuple[int, dict]] = []
    for idx, r in enumerate(results):
        r_title = r.get("title") or ""
        r_title_low = r_title.lower()
        if any(k in r_title_low for k in skip_norm):
            continue

        # Skip if any artist name matches a placeholder/cover pattern
        r_artists = r.get("artists") or []
        artist_names_low = [(a.get("name") or "").lower() for a in r_artists]
        if any(k in name for name in artist_names_low for k in skip_artist_norm):
            continue

        dur = r.get("duration_seconds")
        if dur is None:
            d_text = r.get("duration") or ""
            try:
                parts = [int(x) for x in d_text.split(":") if x]
                if len(parts) == 2:
                    dur = parts[0] * 60 + parts[1]
                elif len(parts) == 3:
                    dur = parts[0] * 3600 + parts[1] * 60 + parts[2]
            except ValueError:
                dur = None
        if dur is not None and not (dur_min <= dur <= dur_max):
            continue

        score = 0
        title_hit = False
        rn = _norm(r_title)
        if nt and rn and (nt in rn or rn in nt):
            score += 15
            title_hit = True
        elif nt and rn:
            common = len(set(nt) & set(rn))
            if common >= 2:
                score += min(common, 8)
                title_hit = True
            elif common == 1:
                score += 1

        artist_hit = False
        for avars in nartist_sets:
            for ra in r_artists:
                ra_n = _norm(ra.get("name") or "")
                if any(v in ra_n or ra_n in v for v in avars):
                    artist_hit = True
                    break
            if artist_hit:
                score += 10
                break

        # 双信号门槛:标题与艺人至少一个命中,否则视为无关结果(宁缺毋错)
        if not title_hit and not artist_hit:
            continue

        # 搜索位置先验:YTM 相关性排序,前几名加权
        score += max(0, 16 - 3 * idx)

        if r.get("resultType") == "song":
            score += 5

        # Soft penalty for live/acoustic/demo/etc.
        if any(k in r_title_low for k in depr_norm):
            score -= deprioritize_penalty

        scored.append((score, r))

    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


def _build_ydl_opts(out_template: str) -> dict:
    postprocessors: list[dict] = []
    # Order matters: remux webm->opus FIRST so EmbedThumbnail sees a supported file.
    postprocessors.append({
        "key": "FFmpegVideoRemuxer",
        "preferedformat": "webm>opus",
    })
    if config.EMBED_METADATA:
        postprocessors.append({"key": "FFmpegMetadata", "add_metadata": True})
    if config.EMBED_THUMBNAIL:
        postprocessors.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})

    opts: dict = {
        "format": config.FORMAT_PREFERENCE,
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ignoreerrors": False,
        "writethumbnail": config.EMBED_THUMBNAIL,
        "postprocessors": postprocessors,
        "retries": 3,
        "fragment_retries": 3,
    }
    if config.PROXY:
        opts["proxy"] = config.PROXY
    if config.YOUTUBE_PLAYER_CLIENT:
        opts["extractor_args"] = {
            "youtube": {"player_client": [config.YOUTUBE_PLAYER_CLIENT]}
        }
    if config.COOKIES_FILE:
        opts["cookiefile"] = config.COOKIES_FILE
    elif config.COOKIES_FROM_BROWSER:
        opts["cookiesfrombrowser"] = (config.COOKIES_FROM_BROWSER,)
    if not config.COOKIES_FILE and not config.COOKIES_FROM_BROWSER:
        log.warning("No cookies configured. YouTube Music may require authentication.")
    return opts


def download_by_video_id(
    video_id: str,
    out_dir: Path,
    file_stem: str,
) -> dict:
    """Download a YT video by ID. Returns metadata dict (no exception on success)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(out_dir / f"{file_stem}.%(ext)s")
    url = f"https://music.youtube.com/watch?v={video_id}"

    opts = _build_ydl_opts(out_template)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    final = info.get("requested_downloads", [{}])[0].get("filepath") or info.get("filepath")
    if not final:
        ext = info.get("ext", "m4a")
        final = str(out_dir / f"{file_stem}.{ext}")
    return {
        "video_id": video_id,
        "yt_title": info.get("title"),
        "yt_artist": info.get("artist") or info.get("uploader"),
        "duration": info.get("duration"),
        "filepath": final,
    }


def process_song(song: dict) -> dict:
    """End-to-end: search -> pick -> download. Returns result dict."""
    title = song["title"]
    artists = song["artists"]

    primary_artist = artists[0] if artists else ""
    file_stem = sanitize_filename(
        f"{primary_artist} - {title}" if primary_artist else title
    )

    last_err: Optional[str] = None
    for attempt in range(1, config.RETRY_TIMES + 1):
        try:
            results = search_song(title, artists, limit=config.SEARCH_LIMIT)
            best = pick_best(
                results, title, artists,
                config.SKIP_KEYWORDS,
                config.DURATION_MIN_SEC,
                config.DURATION_MAX_SEC,
                deprioritize_keywords=config.DEPRIORITIZE_KEYWORDS,
                deprioritize_penalty=config.DEPRIORITIZE_PENALTY,
                skip_artist_keywords=getattr(config, "SKIP_ARTIST_KEYWORDS", None),
            )
            if best is None:
                last_err = "no_match_after_filter"
                if not results:
                    last_err = "no_search_results"
                return {
                    "ok": False,
                    "reason": last_err,
                    "raw_results_count": len(results),
                    "song": song,
                }

            video_id = best.get("videoId")
            if not video_id:
                return {"ok": False, "reason": "missing_videoId", "song": song}

            meta = download_by_video_id(video_id, config.DOWNLOADS_DIR, file_stem)
            # 自学习:成功后把命中的同义变体名记入别名表(manual 条目受保护)
            matched_names = [a.get("name") or "" for a in (best.get("artists") or [])]
            for req in artists:
                artist_alias.learn_matched(req, matched_names)
                artist_alias.record_hit(req)
            return {
                "ok": True,
                "song": song,
                "match": {
                    "videoId": video_id,
                    "title": best.get("title"),
                    "artists": [a.get("name") for a in (best.get("artists") or [])],
                    "duration": best.get("duration"),
                    "resultType": best.get("resultType"),
                },
                "download": meta,
            }
        except yt_dlp.utils.DownloadError as e:
            last_err = f"download_error: {e}"
            log.warning("Download error (attempt %d/%d) for '%s': %s",
                        attempt, config.RETRY_TIMES, file_stem, e)
        except Exception as e:
            last_err = f"unexpected: {type(e).__name__}: {e}"
            log.warning("Unexpected error (attempt %d/%d) for '%s': %s",
                        attempt, config.RETRY_TIMES, file_stem, e)

        if attempt < config.RETRY_TIMES:
            backoff = config.RETRY_BACKOFF[min(attempt - 1, len(config.RETRY_BACKOFF) - 1)]
            time.sleep(backoff)

    return {"ok": False, "reason": last_err or "unknown", "song": song}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    test_song = {"title": "起风了", "artists": ["买辣椒也用券"], "raw": "起风了-买辣椒也用券"}
    result = process_song(test_song)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
