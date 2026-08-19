"""Download music from a list of YouTube URLs directly — no search step needed."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import yt_dlp

import config
from downloader import sanitize_filename, _build_ydl_opts, _get_ytmusic

log = logging.getLogger(__name__)

# Match YouTube video IDs from various URL formats
_YT_ID_RE = re.compile(
    r"(?:v=|/v/|/embed/|/shorts/|/watch\?.*v=|youtu\.be/|/e/|/vi?/)([A-Za-z0-9_-]{11})"
)
# playlist/album list id, 如 ...playlist?list=PLxxx / OLAK5uy_xxx(专辑) / RDxxx(电台)
_PLAYLIST_ID_RE = re.compile(r"[?&]list=([A-Za-z0-9_-]+)")
# Lines that are comments or blank
_COMMENT_RE = re.compile(r"^\s*(#|$)")


def extract_video_id(url: str) -> Optional[str]:
    """Extract the 11-char YouTube video ID from a URL."""
    m = _YT_ID_RE.search(url)
    return m.group(1) if m else None


def extract_playlist_id(url: str) -> Optional[str]:
    m = _PLAYLIST_ID_RE.search(url)
    return m.group(1) if m else None


def _info_opts() -> dict:
    """元数据探测配置:与 _build_ydl_opts 同源的 cookies/客户端参数,
    否则在被 bot 标记的 IP 上探测步直接失败,连着重试拖垮整个批。"""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "extract_flat": False,
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
    return opts


def _expand_via_ytmusic(playlist_id: str) -> list[dict]:
    """ytmusicapi 展开歌单/专辑:快且带干净的 title/artists 元数据。"""
    try:
        ytm = _get_ytmusic()
        pl = ytm.get_playlist(playlist_id, limit=None)  # None = 全部曲目
        tracks = []
        for t in pl.get("tracks") or []:
            vid = t.get("videoId")
            if vid:
                tracks.append({
                    "videoId": vid,
                    "title": t.get("title") or "",
                    "artists": [a.get("name", "") for a in t.get("artists") or []],
                })
        return tracks
    except Exception as e:
        log.warning("ytmusicapi get_playlist(%s) failed: %s", playlist_id, e)
        return []


def _expand_via_ytdlp(url: str) -> list[dict]:
    """yt-dlp flat 兜底展开(私有歌单/接口失败时)。只拿 videoId,无干净元数据。"""
    opts = _info_opts() | {"extract_flat": "in_playlist", "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        return [
            {"videoId": e.get("id"), "title": e.get("title") or "", "artists": []}
            for e in (info.get("entries") or [])
            if e.get("id")
        ]
    except Exception as e:
        log.warning("yt-dlp flat expand failed for %s: %s", url, e)
        return []


def expand_url(url: str) -> list[dict]:
    """URL -> 曲目列表[{videoId,title,artists}]。
    playlist/专辑 URL 展开全部曲目;watch URL 返回单曲;展开失败降级单曲。"""
    playlist_id = extract_playlist_id(url)
    if playlist_id:
        tracks = _expand_via_ytmusic(playlist_id) or _expand_via_ytdlp(url)
        if tracks:
            return tracks
        log.warning("playlist %s 展开失败,尝试按单曲处理", playlist_id)
    vid = extract_video_id(url)
    if vid:
        return [{"videoId": vid, "title": "", "artists": []}]
    return []


def load_urls(path: Path) -> list[str]:
    """Read one URL per line, skip comments and blanks."""
    urls: list[str] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if _COMMENT_RE.match(line):
                continue
            url = line.strip()
            if url:
                urls.append(url)
    # Dedupe while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for u in urls:
        vid = extract_video_id(u)
        key = vid or u
        if key not in seen:
            seen.add(key)
            unique.append(u)
    return unique


def download_from_url(url: str, out_dir: Path, meta: Optional[dict] = None) -> dict:
    """Download a single YouTube URL as audio. Returns result dict.

    meta: 展开歌单时自带的 {title, artists},可跳过探测请求直接命名。
    """
    last_err: Optional[str] = None
    for attempt in range(1, config.RETRY_TIMES + 1):
        try:
            if meta and meta.get("title"):
                title = meta["title"]
                artist = "、".join(a for a in meta.get("artists", []) if a)
            else:
                with yt_dlp.YoutubeDL(_info_opts()) as ydl:
                    info = ydl.extract_info(url, download=False)
                title = info.get("title") or "untitled"
                artist = info.get("artist") or info.get("uploader") or ""
            file_stem = sanitize_filename(
                f"{artist} - {title}" if artist else title
            )

            out_dir.mkdir(parents=True, exist_ok=True)
            out_template = str(out_dir / f"{file_stem}.%(ext)s")

            opts = _build_ydl_opts(out_template)
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)

            final = (
                info.get("requested_downloads", [{}])[0].get("filepath")
                or info.get("filepath")
            )
            if not final:
                ext = info.get("ext", "opus")
                final = str(out_dir / f"{file_stem}.{ext}")

            return {
                "ok": True,
                "url": url,
                "video_id": info.get("id"),
                "yt_title": info.get("title"),
                "yt_artist": artist,
                "duration": info.get("duration"),
                "filepath": final,
            }

        except yt_dlp.utils.DownloadError as e:
            last_err = f"download_error: {e}"
            log.warning("Download error (attempt %d/%d): %s", attempt, config.RETRY_TIMES, e)
        except Exception as e:
            last_err = f"unexpected: {type(e).__name__}: {e}"
            log.warning("Unexpected error (attempt %d/%d): %s", attempt, config.RETRY_TIMES, e)

        if attempt < config.RETRY_TIMES:
            backoff = config.RETRY_BACKOFF[min(attempt - 1, len(config.RETRY_BACKOFF) - 1)]
            time.sleep(backoff)

    return {"ok": False, "reason": last_err or "unknown", "url": url}


def setup_logging() -> Path:
    config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = config.LOGS_DIR / f"run_urls_{ts}.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )
    logging.getLogger("yt_dlp").setLevel(logging.WARNING)
    return log_file


def _load_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("Corrupted %s; starting fresh", path)
    return {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str),
                   encoding="utf-8")
    tmp.replace(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Download audio from a list of YouTube URLs"
    )
    src_group = parser.add_mutually_exclusive_group(required=True)
    src_group.add_argument(
        "--file", type=Path,
        help="File with one YouTube URL per line",
    )
    src_group.add_argument(
        "--urls", nargs="+", metavar="URL",
        help="One or more YouTube URLs directly on the command line",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Skip URLs already in the success log",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Limit number of URLs to process",
    )
    args = parser.parse_args(argv)

    log_file = setup_logging()
    logging.info("Log file: %s", log_file)
    logging.info("Downloads dir: %s", config.DOWNLOADS_DIR)

    config.DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

    if args.file:
        if not args.file.exists():
            logging.error("File not found: %s", args.file)
            return 1
        urls = load_urls(args.file)
    else:
        urls = args.urls

    logging.info("Loaded %d unique URLs", len(urls))

    # 展开:watch 单曲 + playlist/专辑整表
    items: list[dict] = []
    for u in urls:
        tracks = expand_url(u)
        pl = extract_playlist_id(u)
        if pl:
            logging.info("Playlist %s -> %d tracks", pl, len(tracks))
        items.extend({"url": u, **t} for t in tracks)

    # 去重(跨 list 的 videoId 相同只下一次)
    seen_vids: set[str] = set()
    unique: list[dict] = []
    dup = 0
    for it in items:
        if it["videoId"] in seen_vids:
            dup += 1
            continue
        seen_vids.add(it["videoId"])
        unique.append(it)
    if dup:
        logging.info("Dedup: dropped %d duplicate tracks across inputs", dup)
    items = unique

    if args.limit > 0:
        items = items[:args.limit]

    url_success_log = config.LOGS_DIR / "url_success.json"
    url_failed_log = config.LOGS_DIR / "url_failed.json"

    success = _load_json(url_success_log) if args.resume else {}
    failed: dict = {}

    if args.resume:
        # 按历史 videoId 跳过(而非 URL):同一首曲子换了 URL/来自不同歌单也算已下载
        done_vids = {
            r.get("video_id") for r in success.values() if r.get("video_id")
        }
        before = len(items)
        items = [it for it in items if it["videoId"] not in done_vids]
        logging.info("Resume: %d already downloaded, %d to go",
                     before - len(items), len(items))

    if not items:
        logging.info("Nothing to do.")
        return 0

    logging.info("Starting %d downloads with concurrency=%d",
                 len(items), config.CONCURRENT_DOWNLOADS)

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=config.CONCURRENT_DOWNLOADS
    ) as ex:
        future_to_item = {
            ex.submit(
                download_from_url,
                f"https://music.youtube.com/watch?v={it['videoId']}",
                config.DOWNLOADS_DIR,
                {"title": it.get("title"), "artists": it.get("artists")},
            ): it
            for it in items
        }
        for fut in concurrent.futures.as_completed(future_to_item):
            it = future_to_item[fut]
            completed += 1
            try:
                result = fut.result()
            except Exception as e:
                result = {"ok": False, "reason": f"thread_exception: {e}"}

            label = f"[{completed}/{len(items)}]"
            if result.get("ok"):
                success[it["videoId"]] = result
                path = result.get("filepath", "?")
                logging.info("%s OK  | %s -> %s", label, it["videoId"], path)
            else:
                failed[it["videoId"]] = result
                logging.warning("%s FAIL| %s | %s",
                                label, it["videoId"], result.get("reason"))

            _save_json(url_success_log, success)
            _save_json(url_failed_log, failed)

    logging.info("Finished. Success: %d / Failed: %d / Total: %d",
                 len(success), len(failed), len(success) + len(failed))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
