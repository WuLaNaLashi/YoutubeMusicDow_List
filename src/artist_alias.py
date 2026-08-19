"""艺人别名表:跨语言艺人名映射,持久化于 src/artist_alias.json。

目标:歌单里的中文俗名(少女时代/高耀太)在 YT Music 上是标准名(Girls' Generation/KOYOTE),
纯子串匹配永远对不上。本表把请求名映射到一组别名,参与 pick_best 艺人打分与搜索 query 构造。

三条完善途径(source 三档,人工优先):
  manual       人工编辑,自动写入永不触碰;
  auto_search  main 启动时增量反查 YTM 艺人搜索(汉字名 -> 纯拉丁标准名,保守规则);
  learned      下载成功后,把实际命中的同义变体名(如繁体写法)记入。

并发安全:线程锁 + 临时文件原子替换。下载线程池(默认 3)可并发调用学习。
"""
from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Callable, Iterable, Optional

import config

log = logging.getLogger(__name__)

SOURCE_PRIORITY = {"manual": 2, "auto_search": 1, "learned": 0}
_MAX_ALIASES = 8

_LOCK = threading.Lock()
_CACHE: Optional[dict] = None  # {请求名: {"aliases": [...], "source": "manual", "hits": 0}}

# 汉字/假名/谚文(韩文):用于"请求名是中文、结果是纯拉丁标准名才采纳"的反查规则
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def _norm(s: str) -> str:
    """与 downloader._norm 对齐的轻量版(不含 opencc,别名匹配主逻辑在 downloader 侧)。"""
    return re.sub(r"[\s\W_]+", "", (s or "").lower(), flags=re.UNICODE)


def _load() -> dict:
    global _CACHE
    if _CACHE is None:
        path: Path = config.ARTIST_ALIAS_FILE
        if path.exists():
            try:
                _CACHE = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                log.warning("Corrupted %s (%s); starting fresh", path, e)
                _CACHE = {}
        else:
            _CACHE = {}
    return _CACHE


def _save_locked() -> None:
    """已持锁调用。原子写,防止并发下载线程写坏文件。"""
    path: Path = config.ARTIST_ALIAS_FILE
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(_load(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


def _entry(name: str) -> dict:
    table = _load()
    return table.setdefault(
        name, {"aliases": [], "source": "auto_search", "hits": 0}
    )


def expand(name: str) -> list[str]:
    """请求名 -> [原名, *别名],用于打分时的艺人匹配集合。"""
    if not name:
        return []
    with _LOCK:
        entry = _load().get(name)
        aliases = list(entry["aliases"]) if entry else []
    return [name] + aliases


def primary_name(name: str) -> str:
    """搜索 query 用名:有别名取第一个(标准名,如 高耀太->KOYOTE),否则原名。"""
    with _LOCK:
        entry = _load().get(name)
        if entry and entry["aliases"]:
            return entry["aliases"][0]
    return name


def add_alias(name: str, alias: str, source: str) -> bool:
    """新增别名。manual 条目拒绝自动写入;同名(归一后)去重;上限保护。"""
    if not name or not alias or _norm(name) == _norm(alias):
        return False
    with _LOCK:
        table = _load()
        entry = table.get(name)
        if entry is None:
            entry = {"aliases": [], "source": source, "hits": 0}
            table[name] = entry
        elif entry.get("source") == "manual" and source != "manual":
            return False
        if _MAX_ALIASES and len(entry["aliases"]) >= _MAX_ALIASES:
            return False
        if any(_norm(a) == _norm(alias) for a in entry["aliases"]):
            return False
        entry["aliases"].append(alias)
        _save_locked()
    return True


def record_hit(name: str, count: int = 1) -> None:
    """下载成功调用:命中计数,让"越来越常用"可感知。"""
    with _LOCK:
        entry = _load().get(name)
        if entry is not None:
            entry["hits"] = entry.get("hits", 0) + count
            _save_locked()


def bootstrap(
    artists: Iterable[str],
    search_fn: Callable[[str], list[str]],
) -> int:
    """启动时增量反查:表里没有的艺人,取 YTM 艺人搜索候选。

    保守采纳规则(实测过滤掉全部已知误映射,如 Rain->Tribal Rain、尹恩惠->Baby Vox):
      只取反查 top1;请求名含汉字 && top1 为纯拉丁名(与请求名不同)才采纳。
      top2 起混入成员名/相关艺人(少女时代->Tiffany、泫雅->Psy),一概不收;
      top1 与请求名归一后相同(如 QQ飞车->QQ飞车)由 add_alias 去重兜底,自然跳过。
    其余(拉丁->拉丁、汉字->谚文)不自动采纳,留给人工或 learned 学习。
    """
    added = 0
    for name in artists:
        if not name or not _CJK_RE.search(name):
            continue
        with _LOCK:
            # 已有"非空别名"的条目跳过(反查过/人工维护过);
            # 库整理写入的 learned 空条目仍可反查,补上跨语言标准名
            entry = _load().get(name)
            if entry and entry.get("aliases"):
                continue
        try:
            candidates = search_fn(name)
        except Exception as e:
            log.warning("Artist lookup failed for %r: %s", name, e)
            continue
        top = candidates[0] if candidates else ""
        if top and not _CJK_RE.search(top) and add_alias(name, top, "auto_search"):
            added += 1
    if added:
        log.info("Artist alias: %d new cross-language mappings added", added)
    return added


def learn_matched(request_artist: str, matched_names: Iterable[str]) -> None:
    """下载成功后学习:实际命中的同义变体名(繁体/带后缀的频道名)。

    只学"确实命中了匹配逻辑"(子串关系成立)且与请求名归一后不同的名字,
    不做无差别的关联学习,避免把 feat 艺人错误挂到主艺人名下。
    """
    if not request_artist:
        return
    req_n = _norm(request_artist)
    if not req_n:
        return
    for m in matched_names:
        m_n = _norm(m)
        if not m_n or m_n == req_n:
            continue
        if req_n in m_n or m_n in req_n:
            if add_alias(request_artist, m, "learned"):
                log.info("Artist alias learned: %r += %r", request_artist, m)
