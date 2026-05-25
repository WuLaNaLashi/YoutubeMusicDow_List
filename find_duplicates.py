#!/usr/bin/env python3
"""找出 163 (mp3) 与 Youtube (opus/m4a) 文件夹中的重复歌曲，将重复项从 YT 目录移至 may 目录。

命名规则不确定: 两个文件夹都可能出现 "Title - Artist" 或 "Artist - Title"。
每个文件同时用两种策略解析，匹配时 2×2=4 轮比较，只要有一组搭上就算重复。
"""

import os
import re
import shutil
from difflib import SequenceMatcher
from pathlib import Path

MP3_DIR = Path("/home/hanxiao/Music/163")
YT_DIR = Path("/home/hanxiao/Music/YouTube-20260520")
DEST_DIR = Path("/home/hanxiao/Music/may")

# 不移动的分类 (ok / no_artist)
# 可选: 只处理非 ok 分类，避免误移。设 None 则全量扫描。
ONLY_CLASSES = None  # 例: {"warn_alias_likely", "warn_partial_artist", "warn_title_diff", "mismatch", "ok_no_artist"}
# 若只想处理非 ok，取消下行注释:
# ONLY_CLASSES = {"warn_alias_likely", "warn_partial_artist", "warn_title_diff", "mismatch", "ok_no_artist", "warn_no_artist", "warn_title_only"}


def parse_both(filename: str):
    """对一个文件名用两种策略各解析一次，返回 [(title, artist), ...] 两个候选。

    策略 A (title-first):  按最后一个 "-" 或 " - " 切 → 左边=title, 右边=artist
    策略 B (artist-first): 按第一个  " - "  切 → 左边=artist, 右边=title
    """
    name = filename.rsplit(".", 1)[0]
    has_dash_space = " - " in name
    has_dash = "-" in name

    results = []

    # 策略 A: title-first (按最后一个分隔符)
    if has_dash_space:
        parts = name.rsplit(" - ", 1)
    elif has_dash:
        parts = name.rsplit("-", 1)
    else:
        parts = [name, ""]
    results.append((parts[0].strip(), parts[1].strip() if len(parts) > 1 else ""))

    # 策略 B: artist-first (按第一个 " - "，仅在存在 " - " 时有效)
    if has_dash_space:
        parts = name.split(" - ", 1)
        results.append((parts[1].strip(), parts[0].strip()))

    # 去重 (两种策略可能得到相同结果)
    unique = []
    for t, a in results:
        if (t, a) not in unique:
            unique.append((t, a))
    return unique


def normalize(s: str) -> str:
    """归一化: 小写、去括号、去标点差异、统一分隔符."""
    s = s.lower().strip()
    # 去掉括号及内容 (含全角)
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    s = re.sub(r"[［\[][^］\]]*[］\]]", "", s)
    s = re.sub(r"[【][^】]*[】]", "", s)
    s = re.sub(r"[「『][^」』]*[」』]", "", s)
    # 移除 live / remix 等标注性后缀
    s = re.sub(r"\s*[（(]?(live|remix|acoustic|demo|instrumental|伴奏)[）)]?", "", s, flags=re.IGNORECASE)
    # 统一空白
    s = re.sub(r"\s+", " ", s).strip()
    # 统一艺人分隔符
    s = s.replace("、", ",")
    s = s.replace("&", ",")
    s = s.replace(" _ ", ",")
    # 去除非关键标点
    s = re.sub(r"[·•「」『』""''＂]", "", s)
    return s


def sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def artist_similarity(a: str, b: str) -> float:
    """艺人相似度: 取整体 + 首位艺人子集匹配的最大值."""
    scores = [sim(a, b)]
    # 若一方是多艺人，也试首位艺人
    for sep in [",", "、", "&", " _ "]:
        if sep in a:
            scores.append(sim(a.split(sep)[0].strip(), b))
        if sep in b:
            scores.append(sim(a, b.split(sep)[0].strip()))
    return max(scores)


def is_match(t1: str, a1: str, t2: str, a2: str) -> bool:
    n_t1 = normalize(t1); n_t2 = normalize(t2)
    n_a1 = normalize(a1); n_a2 = normalize(a2)

    title_sim = sim(n_t1, n_t2)
    art_sim   = artist_similarity(n_a1, n_a2)

    return title_sim >= 0.85 and art_sim >= 0.80


def load_class_map() -> dict:
    """尝试从 success.json 或 match_report 加载每首 YT 文件的分类。没有则返回空。"""
    import json
    # 尝试 match_report.md (不做了，太复杂)
    # 尝试 success.json
    success_path = Path("/home/hanxiao/Music/YoutubeMusicDow_List/logs/success.json")
    if not success_path.exists():
        return {}
    with open(success_path) as f:
        data = json.load(f)
    # success.json 里的 key 用 "Artist - Title" 或别的格式
    class_map = {}
    for entry in data:
        if isinstance(entry, dict):
            artist = entry.get("artist", "")
            title = entry.get("title", "")
            cls = entry.get("check_class", entry.get("class", ""))
            fname = f"{artist} - {title}.opus"
            class_map[fname] = cls
            class_map[f"{artist} - {title}.m4a"] = cls
    return class_map


def main():
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    class_map = load_class_map()
    if class_map:
        print(f"已加载 {len(class_map)} 条分类记录")

    # 解析所有文件，每个文件生成两种候选 (title, artist)
    mp3_entries = []  # (filename, [(title, artist), ...])
    for f in sorted(os.listdir(MP3_DIR)):
        if f.lower().endswith(".mp3"):
            mp3_entries.append((f, parse_both(f)))
    print(f"163  (mp3):  {len(mp3_entries)} 首")

    yt_entries = []  # (filename, [(title, artist), ...])
    for f in sorted(os.listdir(YT_DIR)):
        if f.rsplit(".", 1)[-1].lower() in ("opus", "m4a"):
            yt_entries.append((f, parse_both(f)))
    print(f"YT   (opus/m4a): {len(yt_entries)} 首")

    # 2×2 匹配: 每个YT文件的每种解析 × 每个MP3文件的每种解析
    matches: list[tuple[str, str]] = []  # (yt_f, mp3_f)
    matched_yt = set()

    for yt_f, yt_candidates in yt_entries:
        if ONLY_CLASSES and class_map:
            cls = class_map.get(yt_f, "")
            if cls and cls not in ONLY_CLASSES:
                continue

        for mp3_f, mp3_candidates in mp3_entries:
            if mp3_f in {m[1] for m in matches}:
                continue  # 一个 mp3 只匹配一次
            hit = False
            for yt_t, yt_a in yt_candidates:
                for mp3_t, mp3_a in mp3_candidates:
                    if is_match(yt_t, yt_a, mp3_t, mp3_a):
                        hit = True
                        break
                if hit:
                    break
            if hit:
                matches.append((yt_f, mp3_f))
                matched_yt.add(yt_f)

    print(f"\n匹配:   {len(matches)} 首")
    print(f"无匹配: {len(yt_entries) - len(matched_yt)} 首")

    if matches:
        print("\n" + "=" * 60)
        print("匹配详情 (前 30 条):")
        for yt_f, mp3_f in matches[:30]:
            print(f"  {yt_f}")
            print(f"    <-> {mp3_f}")
        if len(matches) > 30:
            print(f"  ... 及其他 {len(matches) - 30} 条")

    # 移动
    if matches:
        print(f"\n将 {len(matches)} 个文件移至 {DEST_DIR} ...")
        for yt_f, _ in matches:
            src = YT_DIR / yt_f
            dst = DEST_DIR / yt_f
            if src.exists():
                shutil.move(str(src), str(dst))
            else:
                print(f"  [跳过] 文件不存在: {yt_f}")
        print("完成。")
    else:
        print("\n未找到重复歌曲。")


if __name__ == "__main__":
    main()
