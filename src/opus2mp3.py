"""Transcode .opus -> .mp3 under a directory, preserving cover art and tags.

Opus -> mp3 is lossy -> lossy, so we use 320 kbps CBR (libmp3lame's max) to
minimize quality loss. The embedded cover (METADATA_BLOCK_PICTURE) and common
text tags are copied from the opus into the mp3 via mutagen.

No new dependencies: reuses mutagen (already required) + system ffmpeg.

Output goes into a `mp3/` subfolder under --dir (created if missing), flattened
and name-deduped; source .opus are kept unless --delete-original is given.

Examples:
  # preview (dry-run, default)
  python src/opus2mp3.py --dir /path/to/songs
  # actually transcode
  python src/opus2mp3.py --dir /path/to/songs --apply
  # recursive + delete source opus after a successful transcode
  python src/opus2mp3.py --dir /path/to/songs --recursive --apply --delete-original
"""
from __future__ import annotations

import argparse
import base64
import subprocess
import sys
from pathlib import Path

from mutagen.flac import Picture
from mutagen.id3 import (
    APIC,
    TALB,
    TCON,
    TDRC,
    TIT2,
    TPE1,
    ID3,
    ID3NoHeaderError,
)
from mutagen.oggopus import OggOpus

# Vorbis-comment key -> ID3 frame, for the tags worth keeping.
# description/purl/synopsis (YouTube junk) are intentionally dropped.
_TAG_MAP = {
    "title": TIT2,
    "artist": TPE1,
    "album": TALB,
    "genre": TCON,
}


def find_opus_files(root: Path, recursive: bool) -> list[Path]:
    pattern = "**/*.opus" if recursive else "*.opus"
    return sorted(p for p in root.glob(pattern) if p.is_file())


def transcode(src: Path, dst: Path, bitrate: str) -> None:
    """opus -> mp3, audio only. No resampling — keeps source sample rate."""
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-vn",                 # cover lives in tags, not a video stream
        "-c:a", "libmp3lame",
        "-b:a", bitrate,
        str(dst),
    ]
    subprocess.run(cmd, check=True)


def copy_metadata(src: Path, dst: Path) -> tuple[int, list[str]]:
    """Copy opus tags + cover into the mp3. Returns (covers, copied_labels)."""
    vtags = dict(OggOpus(src).tags)

    # Start from a clean ID3 tag block (ffmpeg writes none for audio-only).
    try:
        id3 = ID3(dst)
        id3.delete(dst)
    except ID3NoHeaderError:
        id3 = ID3()

    # ID3v2.4 + UTF-8: internally consistent. mutagen 1.47 stores the year as
    # TDRC even when saving v2.3, which left a non-conformant v2.4 frame in a
    # v2.3 file; v2.4 is clean and every current player reads it.
    ENC = 3
    copied: list[str] = []
    for vkey, frame_cls in _TAG_MAP.items():
        vals = vtags.get(vkey)
        if vals and vals[0]:
            id3.add(frame_cls(encoding=ENC, text=vals[0]))
            copied.append(vkey)
    date = (vtags.get("date") or [""])[0]
    if date:
        id3.add(TDRC(encoding=ENC, text=date[:4]))
        copied.append("date")

    # Cover: METADATA_BLOCK_PICTURE (base64 FLAC picture block) -> APIC frame.
    covers = 0
    for b64 in vtags.get("metadata_block_picture", []):
        pic = Picture(base64.b64decode(b64))
        id3.add(APIC(encoding=ENC, mime=pic.mime or "image/jpeg",
                     type=pic.type, desc="Cover", data=pic.data))
        covers += 1
    if covers:
        copied.append(f"cover×{covers}")

    id3.save(dst)
    return covers, copied


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--dir", required=True, help="Directory containing .opus files")
    p.add_argument("--recursive", action="store_true", help="Also scan subdirectories")
    p.add_argument("--bitrate", default="320k",
                   help="libmp3lame CBR bitrate (default 320k, the mp3 max)")
    p.add_argument("--delete-original", action="store_true",
                   help="Delete source .opus after a successful transcode")
    p.add_argument("--apply", action="store_true",
                   help="Actually transcode. Without this, runs dry-run.")
    args = p.parse_args(argv)

    root = Path(args.dir)
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 1

    files = find_opus_files(root, args.recursive)
    # Flatten all outputs into <root>/mp3/, dedup bare names within this run.
    out_dir = root / "mp3"
    plan: list[tuple[Path, Path]] = []
    used: set[str] = set()
    for src in files:
        name = f"{src.stem}.mp3"
        if name in used:
            stem, n = src.stem, 2
            while f"{stem} ({n}).mp3" in used:
                n += 1
            name = f"{stem} ({n}).mp3"
        used.add(name)
        plan.append((src, out_dir / name))

    print(f"Dir: {root}  recursive={args.recursive}  bitrate={args.bitrate}")
    print(f"Found {len(files)} .opus file(s) -> mp3/\n")
    if not files:
        return 0

    if not args.apply:
        for src, dst in plan:
            print(f"  {src.name}  ->  mp3/{dst.name}")
        note = "pass --apply to transcode" + (
            " (and --delete-original to remove sources)" if args.delete_original else "")
        print(f"\n(dry-run — {note})")
        return 0

    out_dir.mkdir(exist_ok=True)
    ok = fail = 0
    for i, (src, dst) in enumerate(plan, 1):
        print(f"[{i}/{len(plan)}] {src.name}")
        try:
            transcode(src, dst, args.bitrate)
            _, copied = copy_metadata(src, dst)
            print(f"      -> mp3/{dst.name}  [{', '.join(copied) or 'no-tags'}]")
            if args.delete_original:
                src.unlink()
                print("      deleted source opus")
            ok += 1
        except subprocess.CalledProcessError as e:
            print(f"      FAIL ffmpeg rc={e.returncode}", file=sys.stderr)
            fail += 1
        except Exception as e:
            print(f"      FAIL {type(e).__name__}: {e}", file=sys.stderr)
            fail += 1

    extra = " | sources deleted" if args.delete_original else ""
    print(f"\nDone. transcoded={ok} failed={fail}{extra}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
