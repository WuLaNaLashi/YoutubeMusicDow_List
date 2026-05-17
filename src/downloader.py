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
    query = " ".join([title] + artists)
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
    if not results:
        return None

    nt = _norm(title)
    nartists = [_norm(a) for a in artists]
    skip_norm = [k.lower() for k in skip_keywords]
    skip_artist_norm = [k.lower() for k in (skip_artist_keywords or [])]
    depr_norm = [k.lower() for k in (deprioritize_keywords or [])]

    scored: list[tuple[int, dict]] = []
    for r in results:
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
        rn = _norm(r_title)
        if nt and (nt in rn or rn in nt):
            score += 20
        elif nt and rn:
            common = len(set(nt) & set(rn))
            score += min(common, 10)

        for a in nartists:
            for ra in r_artists:
                if a and a in _norm(ra.get("name") or ""):
                    score += 10
                    break

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
    if config.COOKIES_FROM_BROWSER:
        opts["cookiesfrombrowser"] = (config.COOKIES_FROM_BROWSER,)
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
