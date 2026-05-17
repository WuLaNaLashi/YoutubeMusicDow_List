"""Parse songs_list.txt into structured records."""
from __future__ import annotations
import re
from pathlib import Path
from typing import Optional


def _normalize(s: str) -> str:
    """Lower + strip all non-alphanumeric (incl. CJK punctuation) for dedup keys."""
    return re.sub(r"[\s\W_]+", "", s.lower(), flags=re.UNICODE)


def parse_line(line: str) -> Optional[dict]:
    """Parse one line of the songs list.

    Returns None for blank/invalid lines.
    Splits on the LAST '-' (because some titles contain '-').
    """
    s = line.strip()
    if not s:
        return None

    idx = s.rfind("-")
    if idx == -1:
        # Whole line is title, no artist
        return {"title": s, "artists": [], "raw": s}

    title = s[:idx].strip()
    artist_str = s[idx + 1:].strip()

    if not title:
        return None

    artists: list[str] = []
    if artist_str:
        # ' _ ' is the multi-artist separator in this list
        artists = [a.strip() for a in artist_str.split("_") if a.strip()]

    return {"title": title, "artists": artists, "raw": s}


def load_songs(path: Path) -> list[dict]:
    """Read the songs list, parse, and dedupe.

    Dedup strategy:
      1. Exact normalized (title, artists) match -> drop later occurrences.
      2. If a (title, []) entry exists AND a (title, [some_artist]) exists,
         drop the empty-artist one (the artist-bearing version is canonical).
    """
    raw_songs: list[dict] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            parsed = parse_line(line)
            if parsed is not None:
                raw_songs.append(parsed)

    # Index by normalized title
    by_norm_title: dict[str, list[dict]] = {}
    for s in raw_songs:
        key = _normalize(s["title"])
        by_norm_title.setdefault(key, []).append(s)

    deduped: list[dict] = []
    seen: set[str] = set()

    for s in raw_songs:
        t_norm = _normalize(s["title"])
        a_norm = "|".join(_normalize(a) for a in s["artists"])
        full_key = f"{t_norm}::{a_norm}"

        if full_key in seen:
            continue

        # Soft dedup: drop (title, []) if a (title, [artist...]) exists
        if not s["artists"]:
            siblings = by_norm_title.get(t_norm, [])
            if any(sib["artists"] for sib in siblings):
                continue

        seen.add(full_key)
        deduped.append(s)

    return deduped


def build_search_query(song: dict) -> str:
    """Build a query string for YT Music search."""
    parts = [song["title"]] + song["artists"]
    return " ".join(parts)


if __name__ == "__main__":
    import sys
    import json

    path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).resolve().parent.parent / "songs_list.txt"
    )
    songs = load_songs(path)
    print(f"Loaded {len(songs)} unique songs.")
    print("First 5:")
    for s in songs[:5]:
        print(json.dumps(s, ensure_ascii=False))
    print("\nNo-artist entries (sample):")
    no_artist = [s for s in songs if not s["artists"]][:5]
    for s in no_artist:
        print(json.dumps(s, ensure_ascii=False))
