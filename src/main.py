"""Batch entry point: download songs from songs_list.txt."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import random
import sys
from datetime import datetime
from pathlib import Path

import config
from parse_list import load_songs
from downloader import process_song


def setup_logging() -> Path:
    config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = config.LOGS_DIR / f"run_{ts}.log"
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
            logging.warning("Corrupted %s; starting fresh", path)
    return {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str),
                   encoding="utf-8")
    tmp.replace(path)


def select_test_sample(songs: list[dict], n: int) -> list[dict]:
    rng = random.Random(config.TEST_SEED)
    return rng.sample(songs, min(n, len(songs)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Batch download songs via YT Music")
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--test", type=int, metavar="N",
                   help="Download N random songs (deterministic seed)")
    g.add_argument("--all", action="store_true",
                   help="Download all songs in the list")
    parser.add_argument("--resume", action="store_true",
                        help="Skip songs already in success.json")
    parser.add_argument("--limit", type=int, default=0,
                        help="Limit number of songs (debug)")
    args = parser.parse_args(argv)

    log_file = setup_logging()
    logging.info("Log file: %s", log_file)
    logging.info("Project root: %s", config.PROJECT_ROOT)
    logging.info("Downloads dir: %s", config.DOWNLOADS_DIR)

    config.DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_songs = load_songs(config.SONGS_LIST)
    logging.info("Parsed %d unique songs from %s",
                 len(all_songs), config.SONGS_LIST.name)

    if args.test:
        target = select_test_sample(all_songs, args.test)
        logging.info("Test mode: %d songs (seed=%d)", len(target), config.TEST_SEED)
    else:
        target = all_songs

    if args.limit > 0:
        target = target[: args.limit]

    success = _load_json(config.SUCCESS_LOG) if args.resume else {}
    failed: dict = {}

    if args.resume:
        before = len(target)
        target = [s for s in target if s["raw"] not in success]
        logging.info("Resume: %d already done, %d to go", before - len(target), len(target))

    if not target:
        logging.info("Nothing to do.")
        return 0

    logging.info("Starting %d downloads with concurrency=%d",
                 len(target), config.CONCURRENT_DOWNLOADS)

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=config.CONCURRENT_DOWNLOADS
    ) as ex:
        future_to_song = {ex.submit(process_song, s): s for s in target}
        for fut in concurrent.futures.as_completed(future_to_song):
            song = future_to_song[fut]
            completed += 1
            try:
                result = fut.result()
            except Exception as e:
                result = {"ok": False, "reason": f"thread_exception: {e}", "song": song}

            label = f"[{completed}/{len(target)}]"
            if result.get("ok"):
                success[song["raw"]] = result
                path = result.get("download", {}).get("filepath", "?")
                logging.info("%s OK  | %s -> %s", label, song["raw"], path)
            else:
                failed[song["raw"]] = result
                logging.warning("%s FAIL| %s | %s",
                                label, song["raw"], result.get("reason"))

            # Persist after each completion (resilience)
            _save_json(config.SUCCESS_LOG, success)
            _save_json(config.FAILED_LOG, failed)

    logging.info("Finished. Success: %d / Failed: %d / Total: %d",
                 len(success), len(failed), len(success) + len(failed))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
