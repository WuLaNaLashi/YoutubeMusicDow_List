"""Organize downloaded files into subfolders by match-check classification.

Reads success.json, classifies each entry the same way check_matches.py does,
then moves the corresponding file into downloads/{cls}/ .

Idempotent: if a file is already in the correct subfolder it stays; if it's in
the wrong subfolder it gets moved to the right one.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config
from check_matches import (
    title_similarity, artist_match, classify, CLASS_EMOJI,
)


def find_file(filepath: Path, downloads_dir: Path) -> Path | None:
    """Locate the file by basename; it may have already been moved into a subfolder."""
    if filepath.exists():
        return filepath
    basename = filepath.name
    direct = downloads_dir / basename
    if direct.exists():
        return direct
    if downloads_dir.exists():
        for sub in downloads_dir.iterdir():
            if not sub.is_dir():
                continue
            candidate = sub / basename
            if candidate.exists():
                return candidate
    return None


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="Print plan, do not move anything (default)")
    p.add_argument("--apply", action="store_true",
                   help="Actually move files. Without this, runs in dry-run.")
    p.add_argument("--copy", action="store_true",
                   help="Copy instead of move (with --apply)")
    args = p.parse_args(argv)

    dry_run = not args.apply

    success = json.loads(config.SUCCESS_LOG.read_text(encoding="utf-8"))
    downloads_dir = config.DOWNLOADS_DIR

    plan: list[tuple[Path, Path, str]] = []
    stats: Counter[str] = Counter()
    missing: list[str] = []

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
        stats[cls] += 1

        filepath = (entry.get("download") or {}).get("filepath")
        if not filepath:
            missing.append(f"{raw} (no filepath in success.json)")
            continue

        src = find_file(Path(filepath), downloads_dir)
        if src is None:
            missing.append(f"{raw} ({Path(filepath).name})")
            continue

        target = downloads_dir / cls / src.name
        if src.resolve() == target.resolve():
            stats["__already_correct"] += 1
            continue
        plan.append((src, target, cls))

    # Pretty-print plan summary
    by_cls: dict[str, int] = Counter()
    for _, _, cls in plan:
        by_cls[cls] += 1

    print("\nClassification distribution (from check_matches):")
    for cls in sorted(stats, key=lambda k: (-stats[k], k)):
        if cls.startswith("__"):
            continue
        e = CLASS_EMOJI.get(cls, " ")
        print(f"  {e} {cls:<22} {stats[cls]}")
    if stats.get("__already_correct"):
        print(f"  ✓  already-in-folder      {stats['__already_correct']}")

    print(f"\nPlan: {len(plan)} files to move into subfolders.")
    if by_cls:
        for cls, n in sorted(by_cls.items(), key=lambda x: (-x[1], x[0])):
            print(f"  -> downloads/{cls}/  ({n})")

    if missing:
        print(f"\n⚠️  {len(missing)} entries in success.json whose file was not found on disk:")
        for m in missing[:10]:
            print(f"   - {m}")
        if len(missing) > 10:
            print(f"   ... and {len(missing) - 10} more")

    if dry_run:
        print("\n(dry-run — pass --apply to actually move)")
        return 0

    moved = 0
    failed = 0
    for src, target, cls in plan:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if args.copy:
                shutil.copy2(src, target)
            else:
                shutil.move(str(src), str(target))
            moved += 1
        except Exception as e:
            print(f"  FAIL  {src.name}: {e}")
            failed += 1

    print(f"\nDone. {'Copied' if args.copy else 'Moved'}: {moved}; failed: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
