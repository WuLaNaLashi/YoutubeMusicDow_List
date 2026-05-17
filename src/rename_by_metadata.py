"""Rename audio files to '{embedded_artist} - {embedded_title}.{ext}'.

Identifies which songs to rename via:
  - default:    success.json + check_matches.classify -> only entries
                whose classification is in --classes (default: mismatch)
  - --dir DIR:  rename ALL audio files in DIR (legacy, simpler mode)

Files are searched anywhere under downloads/ — you can flatten the subfolders
before or after running this.

Use --apply to actually rename; default is dry-run.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config
from check_matches import title_similarity, artist_match, classify


_INVALID_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def sanitize(s: str, max_len: int = 180) -> str:
    s = _INVALID_CHARS.sub("_", s or "")
    s = re.sub(r"\s+", " ", s).strip().strip(".")
    return s[:max_len]


def read_embedded(path: Path) -> tuple[str, str] | None:
    ext = path.suffix.lower()
    try:
        if ext == ".opus":
            from mutagen.oggopus import OggOpus
            f = OggOpus(path)
            return (f.get("artist", [""])[0], f.get("title", [""])[0])
        if ext in (".m4a", ".mp4"):
            from mutagen.mp4 import MP4
            f = MP4(path)
            t = f.tags or {}
            return ((t.get("\xa9ART") or [""])[0],
                    (t.get("\xa9nam") or [""])[0])
    except Exception as e:
        print(f"  read error on {path.name}: {e}", file=sys.stderr)
    return None


def build_new_name(artist: str, title: str, ext: str) -> str:
    artist_s = sanitize(artist)
    title_s = sanitize(title)
    if artist_s and title_s:
        stem = f"{artist_s} - {title_s}"
    elif title_s:
        stem = title_s
    elif artist_s:
        stem = artist_s
    else:
        stem = "untitled"
    return f"{stem}{ext}"


def resolve_collision(target: Path) -> Path:
    if not target.exists():
        return target
    stem, ext = target.stem, target.suffix
    parent = target.parent
    n = 2
    while True:
        cand = parent / f"{stem} ({n}){ext}"
        if not cand.exists():
            return cand
        n += 1


def find_file(basename: str, root: Path) -> Path | None:
    """Look for a file with this basename anywhere under root."""
    direct = root / basename
    if direct.exists():
        return direct
    # Fall back to searching subfolders
    for p in root.rglob(basename):
        if p.is_file():
            return p
    return None


def collect_targets_from_success(
    classes_to_rename: set[str], downloads_dir: Path
) -> tuple[list[Path], list[str]]:
    """Returns (files_found, missing_originals)."""
    if not config.SUCCESS_LOG.exists():
        return [], []
    success = json.loads(config.SUCCESS_LOG.read_text(encoding="utf-8"))

    found: list[Path] = []
    missing: list[str] = []
    for raw, entry in success.items():
        song = entry.get("song", {}) or {}
        match = entry.get("match", {}) or {}
        sim = title_similarity(song.get("title", ""), match.get("title", ""))
        astat = artist_match(song.get("artists", []) or [], match.get("artists", []) or [])
        cls = classify(sim, astat, song.get("title", ""), match.get("title", ""))
        if cls not in classes_to_rename:
            continue

        fp = (entry.get("download") or {}).get("filepath")
        if not fp:
            missing.append(f"{raw} (no filepath in success.json)")
            continue

        basename = Path(fp).name
        actual = find_file(basename, downloads_dir)
        if actual is None:
            missing.append(f"{raw} -> {basename}")
            continue
        found.append(actual)

    return found, missing


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--classes", default="mismatch",
                   help="Comma-separated check_matches classes to rename "
                        "(default: mismatch). e.g. 'mismatch,warn_title_diff'")
    g.add_argument("--dir",
                   help="Alternative mode: rename every audio file under this directory")
    p.add_argument("--apply", action="store_true",
                   help="Actually rename. Without this, runs dry-run.")
    p.add_argument("--recursive", action="store_true",
                   help="(only with --dir) Also scan subdirectories")
    args = p.parse_args(argv)

    downloads_dir = config.DOWNLOADS_DIR

    if args.dir:
        target_dir = Path(args.dir)
        if not target_dir.exists():
            print(f"Directory not found: {target_dir}", file=sys.stderr)
            return 1
        pattern = "**/*" if args.recursive else "*"
        files = sorted([
            f for f in target_dir.glob(pattern)
            if f.is_file() and f.suffix.lower() in (".opus", ".m4a", ".mp4")
        ])
        missing: list[str] = []
        print(f"Mode: --dir  ({target_dir})  files={len(files)}")
    else:
        classes = {c.strip() for c in args.classes.split(",") if c.strip()}
        files, missing = collect_targets_from_success(classes, downloads_dir)
        print(f"Mode: success.json,  classes={sorted(classes)},  files found={len(files)}")
        if missing:
            print(f"  (skipped {len(missing)} entries whose file isn't on disk anymore)")
    print()

    if not files:
        print("Nothing to rename.")
        if missing:
            print("\nFiles referenced in success.json but not found on disk:")
            for m in missing[:30]:
                print(f"  - {m}")
            if len(missing) > 30:
                print(f"  ... and {len(missing) - 30} more")
        return 0

    plan: list[tuple[Path, Path]] = []
    unchanged = 0
    unreadable = 0

    for path in files:
        meta = read_embedded(path)
        if meta is None:
            unreadable += 1
            continue
        artist, title = meta
        new_name = build_new_name(artist, title, path.suffix.lower())
        new_path = path.parent / new_name
        if new_path.name == path.name:
            unchanged += 1
            continue
        if new_path.exists() and new_path != path:
            new_path = resolve_collision(new_path)
        plan.append((path, new_path))

    print(f"Plan: {len(plan)} renames | unchanged={unchanged} | unreadable={unreadable}")
    print()
    for src, dst in plan:
        rel_src = src.relative_to(downloads_dir.parent)
        print(f"  {rel_src}")
        print(f"    -> {dst.name}")

    if missing:
        print(f"\n⚠️  {len(missing)} target file(s) not found on disk:")
        for m in missing[:20]:
            print(f"   - {m}")
        if len(missing) > 20:
            print(f"   ... and {len(missing) - 20} more")

    if not args.apply:
        print(f"\n(dry-run — pass --apply to actually rename)")
        return 0

    renamed = 0
    failed = 0
    for src, dst in plan:
        try:
            src.rename(dst)
            renamed += 1
        except Exception as e:
            print(f"  FAIL {src.name}: {e}", file=sys.stderr)
            failed += 1
    print(f"\nDone. renamed={renamed} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
