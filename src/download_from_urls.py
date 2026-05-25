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
from downloader import sanitize_filename, _build_ydl_opts

log = logging.getLogger(__name__)

# Match YouTube video IDs from various URL formats
_YT_ID_RE = re.compile(
    r"(?:v=|/v/|/embed/|/shorts/|/watch\?.*v=|youtu\.be/|/e/|/vi?/)([A-Za-z0-9_-]{11})"
)
# Lines that are comments or blank
_COMMENT_RE = re.compile(r"^\s*(#|$)")


def extract_video_id(url: str) -> Optional[str]:
    """Extract the 11-char YouTube video ID from a URL."""
    m = _YT_ID_RE.search(url)
    return m.group(1) if m else None


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


def download_from_url(url: str, out_dir: Path) -> dict:
    """Download a single YouTube URL as audio. Returns result dict."""
    # First, extract info to get title/uploader for a clean filename
    info_opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "extract_flat": False,
    }
    if config.PROXY:
        info_opts["proxy"] = config.PROXY
    if config.COOKIES_FROM_BROWSER:
        info_opts["cookiesfrombrowser"] = (config.COOKIES_FROM_BROWSER,)

    last_err: Optional[str] = None
    for attempt in range(1, config.RETRY_TIMES + 1):
        try:
            with yt_dlp.YoutubeDL(info_opts) as ydl:
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

    if args.limit > 0:
        urls = urls[:args.limit]

    url_success_log = config.LOGS_DIR / "url_success.json"
    url_failed_log = config.LOGS_DIR / "url_failed.json"

    success = _load_json(url_success_log) if args.resume else {}
    failed: dict = {}

    if args.resume:
        before = len(urls)
        urls = [u for u in urls if u not in success]
        logging.info("Resume: %d already done, %d to go", before - len(urls), len(urls))

    if not urls:
        logging.info("Nothing to do.")
        return 0

    logging.info("Starting %d downloads with concurrency=%d",
                 len(urls), config.CONCURRENT_DOWNLOADS)

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=config.CONCURRENT_DOWNLOADS
    ) as ex:
        future_to_url = {ex.submit(download_from_url, u, config.DOWNLOADS_DIR): u for u in urls}
        for fut in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[fut]
            completed += 1
            try:
                result = fut.result()
            except Exception as e:
                result = {"ok": False, "reason": f"thread_exception: {e}", "url": url}

            label = f"[{completed}/{len(urls)}]"
            if result.get("ok"):
                success[url] = result
                path = result.get("filepath", "?")
                logging.info("%s OK  | %s -> %s", label, url, path)
            else:
                failed[url] = result
                logging.warning("%s FAIL| %s | %s", label, url, result.get("reason"))

            _save_json(url_success_log, success)
            _save_json(url_failed_log, failed)

    logging.info("Finished. Success: %d / Failed: %d / Total: %d",
                 len(success), len(failed), len(success) + len(failed))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
