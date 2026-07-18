# 📚 使用文档索引

本目录包含项目所有脚本的**详细使用说明**。每个脚本一份独立文档，便于单独查阅。

> 总览和快速上手请看 [项目根 README](../README.md)。本目录是各脚本的深入参考。

---

## 🚀 快速上手（5 分钟全流程）

```bash
# 0. 准备 songs_list.txt 歌单（格式见 parse_list.md）
# 1. 测试 10 首验证环境
python src/main.py --test 10
# 2. 全量下载
python src/main.py --all
# 3. 校验匹配质量
python src/check_matches.py
# 4. 按分类挪文件
python src/organize_by_check.py --apply
# 5. review mismatch，按内嵌元数据改名
python src/rename_by_metadata.py --apply \
  --classes mismatch,warn_alias_likely,warn_partial_artist,warn_title_diff
# 6.（可选）转码为 mp3
python src/opus2mp3.py --dir downloads --apply
```

---

## 📖 各脚本文档

### 🔥 核心（最常用）

| 脚本 | 文档 | 作用 |
|------|------|------|
| `src/main.py` | [main.md](main.md) | **批量下载入口**（读歌单 → 搜索 → 下载）|
| `src/opus2mp3.py` | [opus2mp3.md](opus2mp3.md) | opus → mp3 转码（保留封面/标签）|
| `src/check_matches.py` | [check_matches.md](check_matches.md) | 校验下载匹配质量，生成报告 |
| `src/organize_by_check.py` | [organize_by_check.md](organize_by_check.md) | 按分类挪文件到子目录 |

### 🛠️ 辅助（按需用）

| 脚本 | 文档 | 作用 |
|------|------|------|
| `src/download_from_urls.py` | [download_from_urls.md](download_from_urls.md) | 用 YouTube URL 直接下载（跳过搜索）|
| `src/rename_by_metadata.py` | [rename_by_metadata.md](rename_by_metadata.md) | 按内嵌元数据批量改名 |
| `src/list_non_catalog.py` | [list_non_catalog.md](list_non_catalog.md) | 找出非 YT Music 正版编录的歌 |

### ⚙️ 基础设施（偶尔用）

| 脚本 | 文档 | 作用 |
|------|------|------|
| `src/parse_list.py` | [parse_list.md](parse_list.md) | 歌单解析（main.py 的依赖模块）|
| `src/export_cookies.py` | [export_cookies.md](export_cookies.md) | 从浏览器导出 YouTube cookies |
| `find_duplicates.py` | [find_duplicates.md](find_duplicates.md) | 163 与 YT 跨源去重（项目根，非 src/）|

---

## 🗺️ 工作流导图

```
songs_list.txt
     │
     ▼
┌─────────────────┐
│  parse_list.py  │  解析歌单
└────────┬────────┘
         │
         ▼
┌─────────────────┐         ┌──────────────────────┐
│    main.py      │◄────────│  export_cookies.py   │  提供登录凭据
│   （下载入口）   │         └──────────────────────┘
└────────┬────────┘
         │  downloads/*.opus + logs/success.json
         │
         ├──────────────────────────────┐
         ▼                              ▼
┌─────────────────┐            ┌──────────────────────┐
│ check_matches   │            │ list_non_catalog     │
│  （匹配校验）   │            │  （编录识别）        │
└────────┬────────┘            └──────────────────────┘
         │  logs/match_report.md
         │
         ├──────────────┐
         ▼              ▼
┌─────────────────┐  ┌──────────────────────┐
│organize_by_check│  │ rename_by_metadata   │
│  （按类挪文件） │  │  （按内嵌标签改名）  │
└────────┬────────┘  └──────────┬───────────┘
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │     opus2mp3.py      │  转码为 mp3
         │   （输出到 mp3/）    │
         └──────────────────────┘

特殊情况：
  download_from_urls.py  ────► downloads/*.opus  （绕过搜索，URL 直下）
  find_duplicates.py     ────► may/  （跨源去重）
```

---

## 🎯 按场景速查

### 我刚拿到这个项目，想试试

→ [main.md](main.md) 的「典型用法 → 第一次：先测 10 首」

### 下载完了，怎么知道哪些下错了

→ [check_matches.md](check_matches.md) → 看 `logs/match_report.md` 的 ❌ mismatch 段

### 我想让下载的文件能放进 SD 卡音箱播放

→ [opus2mp3.md](opus2mp3.md)（转码为 mp3）

### 某首歌下错了，我有正确的 YouTube 链接

→ [download_from_urls.md](download_from_urls.md)

### 下载的文件名和实际内容对不上

→ [rename_by_metadata.md](rename_by_metadata.md)

### 想把不同质量的文件分到不同文件夹

→ [organize_by_check.md](organize_by_check.md)

### yt-dlp 报 cookies 错误

→ [export_cookies.md](export_cookies.md)

### 想合并网易云和 YouTube 两个音源

→ [find_duplicates.md](find_duplicates.md)

---

## 🔑 核心概念

### dry-run 安全模式

几乎所有写操作的脚本都默认 **dry-run**（只预览不执行）。要真正执行，加 `--apply`：

| 脚本 | 安全开关 |
|------|----------|
| `opus2mp3.py` | `--apply` |
| `organize_by_check.py` | `--apply` |
| `rename_by_metadata.py` | `--apply` |

> **例外**：`find_duplicates.py` 直接执行无 dry-run，使用前请先备份。

### 幂等性

以下脚本可以反复跑，不会产生副作用：
- `check_matches.py`（只读 + 生成报告）
- `organize_by_check.py`（已在正确目录的文件不动）
- `rename_by_metadata.py`（名字已经对的跳过）
- `list_non_catalog.py`（只读 + 生成报告）

### 关键状态文件

| 文件 | 作用 | 谁读 | 谁写 |
|------|------|------|------|
| `logs/success.json` | 下载成功记录（断点续传依据）| main / check_matches / organize / rename | main |
| `logs/failed.json` | 失败明细 | check_matches | main |
| `logs/match_report.md` | 匹配校验报告 | 人 | check_matches |
| `logs/non_ytmusic_report.md` | 编录识别报告 | 人 | list_non_catalog |
| `logs/url_success.json` | URL 模式成功记录 | — | download_from_urls |
| `logs/run_*.log` | 运行日志 | 调试 | main / download_from_urls |

### 8 级匹配分类

`check_matches.py` 把每首歌归到 8 类之一。完整含义见 [check_matches.md](check_matches.md#四匹配分类体系核心)，速查：

| 标签 | 含义 |
|------|------|
| ✅ `ok` | 艺人+标题都对 |
| 🟡 `ok_no_artist` | 歌单缺艺人，标题对得上 |
| 🔵 `warn_alias_likely` | 标题完全一致，艺人字面不同（罗马音/艺名）|
| ⚠️ `warn_title_diff` / `warn_partial_artist` / `warn_no_artist` / `warn_title_only` | 需 review |
| ❌ `mismatch` | 真错了，优先处理 |

---

## 📂 项目结构（参考）

```
YoutubeMusicDow_List/
├── README.md                 ← 项目总览（先看这个）
├── docs/                     ← 你在这里
│   ├── README.md             ← 本索引
│   ├── main.md
│   ├── opus2mp3.md
│   └── ...
├── src/                      ← 所有脚本
│   ├── config.py             # 全局配置
│   ├── main.py
│   └── ...
├── find_duplicates.py        ← 项目根（特殊）
├── songs_list.txt            ← 歌单
├── cookies.txt               ← 登录凭据（gitignore）
├── downloads/                ← 下载产物
├── logs/                     ← 日志与状态
└── cache/                    ← 缓存
```

---

## ❓ 找不到答案？

1. 先看对应脚本的 `.md` 文档的「常见问题」章节
2. 看项目根 [README.md](../README.md) 的 FAQ
3. 跑 `python src/<script>.py --help` 看参数说明
4. 看脚本源码顶部的 docstring
