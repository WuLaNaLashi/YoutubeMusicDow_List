"""从本地音乐库(/home/hanxiao/Music)整理歌手列表,优化 artist_alias.json。

双源甄别(文件名有 歌名-歌手 与 歌手-歌名 两种顺序,不可靠):
  1. 元数据 artist 标签(mutagen,mp3=ID3 / opus=VorbisComment)——标准写法,主源;
  2. 文件名两侧 token 用"种子艺人集"(tag 高频 ∪ 别名表现有名)判序,辅助源。

产出:
  - logs/library_artists.json  全量歌手清单(频次/来源/样例文件),供人工审阅
  - src/artist_alias.json      合并:已有条目补新变体(manual 级保护);
                               新歌手建 learned 空条目(留给 bootstrap 反查补标准名)
用法: python alias_from_library.py [--dry-run]
"""
from __future__ import annotations

import json
import logging
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import mutagen

import config
import artist_alias

log = logging.getLogger(__name__)

MUSIC_ROOT = Path("/home/hanxiao/Music")
OUT_LIST = config.LOGS_DIR / "library_artists.json"

# 多艺人分隔(标签与文件名通用):顿号/逗号/斜杠/&/feat./and(英文小写,防误伤歌名 and?容忍)
_SPLIT_RE = re.compile(r"[、，,/＆&]|(?:\s+feat\.?\s+)|\s+and\s+", re.IGNORECASE)
# 文件名歌名-歌手分隔:中划线(两侧可选空格)
_DASH_RE = re.compile(r"\s+-\s+|\s*-\s*")
# 显然不是艺人的文件名侧(版本标注/垃圾词)
_NON_ARTIST_RE = re.compile(
    r"live|dj版|remix|cover|伴奏|karaoke|版$|official|mv|视频|音频|\d+", re.IGNORECASE
)

try:
    from opencc import OpenCC
    _t2s = OpenCC("t2s")
except Exception:
    _t2s = None


def _norm(s: str) -> str:
    """与 downloader._norm 对齐:繁->简 + 去非字母数字。"""
    if not s:
        return ""
    if _t2s is not None:
        s = _t2s.convert(s)
    return re.sub(r"[\s\W_]+", "", s.lower(), flags=re.UNICODE)


def split_artists(raw: str) -> list[str]:
    return [a.strip() for a in _SPLIT_RE.split(raw or "") if a.strip()]


def read_tag_artist(path: Path) -> list[str]:
    try:
        m = mutagen.File(path, easy=True)
        if not m:
            return []
        vals = m.get("artist") or []
        if isinstance(vals, str):
            vals = [vals]
        out: list[str] = []
        for v in vals:
            out.extend(split_artists(v))
        return out
    except Exception as e:
        log.debug("tag read failed %s: %s", path, e)
        return []


def split_filename(stem: str) -> tuple[str, str]:
    """文件名 -> (左侧, 右侧);无分隔线返回 ("", "")。"""
    parts = _DASH_RE.split(stem, maxsplit=1)
    if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
        return "", ""
    return parts[0].strip(), parts[1].strip()


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    files = [p for p in MUSIC_ROOT.rglob("*")
             if p.suffix.lower() in (".mp3", ".opus") and p.is_file()]
    log.info("扫描 %d 个音频文件", len(files))

    tag_counter: Counter[str] = Counter()          # tag 艺人 -> 出现次数
    file_side: Counter[str] = Counter()            # 文件名侧 token -> 出现次数
    tag_examples: dict[str, str] = {}

    for p in files:
        tag_arts = read_tag_artist(p)
        for a in tag_arts:
            tag_counter[a] += 1
            tag_examples.setdefault(a, p.name)
        left, right = split_filename(p.stem)
        for side in (left, right):
            # 文件名侧同样按 &/顿号拆多艺人("伍佰 & China Blue")
            for part in split_artists(side):
                if part and not _NON_ARTIST_RE.search(part) and len(part) <= 30:
                    file_side[part] += 1

    # 种子艺人集:tag 高频(>=2) ∪ 别名表已有(keys + aliases),归一索引
    alias_table = artist_alias._load()
    seed_norm: dict[str, str] = {}  # norm -> 展示名
    for name in list(alias_table) + [a for e in alias_table.values() for a in e["aliases"]]:
        n = _norm(name)
        if n:
            seed_norm[n] = name
    for a, c in tag_counter.items():
        if c >= 2:
            n = _norm(a)
            if n:
                seed_norm.setdefault(n, a)

    # 文件名判序:一侧命中种子 => 该侧为歌手
    def fuzzy_hit(side: str) -> bool:
        """种子判序 + 模糊包含:『G.E.M. 邓紫棋』含『邓紫棋』也判为艺人侧。"""
        n = _norm(side)
        if not n:
            return False
        if n in seed_norm:
            return True
        return any(len(n) > len(s) and s in n for s in seed_norm if len(s) >= 3)

    fn_artist: Counter[str] = Counter()
    fn_ambiguous: Counter[str] = Counter()   # 两侧都命中(歧义:合作曲或同名)
    fn_unknown: Counter[str] = Counter()     # 两侧都不命中
    for p in files:
        left, right = split_filename(p.stem)
        if not left:
            continue
        l_hit = fuzzy_hit(left)
        r_hit = fuzzy_hit(right)
        if l_hit and r_hit:
            fn_ambiguous[left] += 1
            fn_ambiguous[right] += 1
        elif l_hit:
            fn_artist[left] += 1
        elif r_hit:
            fn_artist[right] += 1
        else:
            fn_unknown[left] += 1
            fn_unknown[right] += 1

    # 汇总歌手清单:tag 源为主,文件名源补缺
    all_artists: dict[str, dict] = {}
    for a, c in tag_counter.items():
        all_artists[a] = {"count": c, "source": "tag", "example": tag_examples[a]}
    for a, c in fn_artist.items():
        if a in all_artists:
            all_artists[a]["source"] = "tag+filename"
        else:
            all_artists[a] = {"count": c, "source": "filename", "example": ""}

    # 只保留可靠艺人:tag 源任意 / 文件名源需 >=2 次(过滤一次性 token)
    reliable = {a: v for a, v in all_artists.items()
                if v["source"] != "filename" or v["count"] >= 2}

    # ---------- 写回 artist_alias.json ----------
    added_entries = 0
    if not dry:
        alias_table = artist_alias._load()
        known_norm = {_norm(k) for k in alias_table}

        for a, v in sorted(reliable.items(), key=lambda kv: -kv[1]["count"]):
            n = _norm(a)
            if len(n) < 2:  # 滤掉 "T"/"Lin" 类单字母 token
                continue
            if v["count"] < 3:  # 长尾(712 个只出现 1 次)留清单不入表
                continue
            if n in known_norm:
                continue
            # 新歌手:建 learned 空条目(交给 bootstrap 反查补标准名)
            alias_table[a] = {"aliases": [], "source": "learned", "hits": 0}
            known_norm.add(n)
            added_entries += 1

        # 简繁等价不进别名;真正不同写法的变体(拉丁/谚文与汉字混用的组)留给人工,
        # 打印提示
        log.info("写回 %d 个新歌手条目", added_entries)
        # 落盘(artist_alias._save_locked 需要 _CACHE 一致,这里直接改的同一对象)
        tmp = config.ARTIST_ALIAS_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(alias_table, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        tmp.replace(config.ARTIST_ALIAS_FILE)

    # ---------- 输出清单 ----------
    OUT_LIST.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "统计": {
            "音频文件": len(files),
            "tag 命中艺人": len(tag_counter),
            "文件名判序歌手": len(fn_artist),
            "可靠歌手合计": len(reliable),
        },
        "歌手清单": dict(
            sorted(reliable.items(), key=lambda kv: -kv[1]["count"])
        ),
        "待人工甄别": {
            "两侧均命中种子(歧义侧)": dict(fn_ambiguous.most_common(30)),
            "两侧均未知的高频token": dict(fn_unknown.most_common(30)),
        },
    }
    OUT_LIST.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    log.info("清单已写 %s;可靠歌手 %d 个(dry=%s)",
             OUT_LIST, len(reliable), dry)
    for a, v in list(sorted(reliable.items(), key=lambda kv: -kv[1]["count"]))[:15]:
        print(f"  {v['count']:3d} 次 | {v['source']:9s} | {a}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
