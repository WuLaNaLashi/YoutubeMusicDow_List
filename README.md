# YT_Music — 批量下载 YouTube Music 歌曲到本地

把一份歌单(每行 `歌名-艺人`)批量下载为本地高音质音频文件,**保留 YouTube 服务端原始音频流(无有损二次转码)**,自动嵌入歌名/艺人/封面元数据,并提供一整套**匹配校验、分类整理、批量改名**工具。

---

## ⚠️ 重要提示:下载结果**不能**保证 100% 是你想要的版本

工具底层依赖 YouTube Music 的搜索 API。由于以下原因,**少量歌曲下载到的内容可能和歌单里写的不一致**:

- **歌曲在 YT Music 上不存在或不是同一艺人版本** — 比如你写 `参商-不才`,但 YT Music 上只有 `小悠` 翻唱的版本,工具会下到 `小悠` 那版
- **YT 搜索把同名歌曲的"另一艺人翻唱"排在前面** — 比如 `画心-杨坤 _ A-Lin`,实际可能下到张靓颖的版本
- **匹配到了 medley/串烧/集锦** — 比如 `天才与白痴-古巨基` 可能下到一首包含"天才与白痴"片段的"金曲连环炮"
- **拿到的是 Live / Remix / 翻唱 / 男声版 / 女声版** — 有过滤,但只能做到尽量;偶尔会漏网
- **歌单数据本身有问题** — 艺人/歌名写反、含 `-` 的艺人名(A-Lin)被切错、单字标题难以精准匹配
- **跨语言同曲识别困难** — `金达莱花-Maya` 实际下到 `Azalea (진달래꽃) by MAYA`,是同首歌但工具无法自动判定

**真实数据参考**(1106 首测试结果):
- ✅ 完美匹配: 约 **66%** (`ok`)
- 🔵 艺人字面不同但很可能是同曲(罗马音/艺名差异): 约 **27%** (`warn_alias_likely`,如 米津玄师↔Kenshi Yonezu、蔡徐坤↔KUN)
- ⚠️ 需要人工 review 的疑似项: 约 **6%** (`warn_*`)
- ❌ 真正不匹配: 约 **1.3%** (`mismatch`)

**因此,跑完 `main.py` 之后强烈建议:**

1. 跑 `check_matches.py` 生成 `logs/match_report.md`,**重点 review ❌ mismatch 和 ⚠️ warn_title_diff 段**
2. 用 `organize_by_check.py` 把文件分类挪进子目录,方便集中检查
3. 对不准的歌曲,用 `rename_by_metadata.py` 按嵌入元数据改名,让文件名和实际内容对上
4. 实在不对的,手动找 videoId 重下、或换其他源(NetEase / QQ Music 等)

**详细机制和分类含义见后续章节** [匹配分类体系](#匹配分类体系) 和 [已知限制](#已知限制)。

---

## 目录

- [⚠️ 重要提示](#️-重要提示下载结果不能保证-100-是你想要的版本)
- [特性](#特性)
- [项目结构](#项目结构)
- [环境准备](#环境准备)
- [快速开始](#快速开始)
- [歌单格式](#歌单格式)
- [详细用法](#详细用法)
  - [`main.py` — 批量下载](#mainpy--批量下载)
  - [`check_matches.py` — 匹配校验](#check_matchespy--匹配校验)
  - [`organize_by_check.py` — 按分类挪文件](#organize_by_checkpy--按分类挪文件)
  - [`rename_by_metadata.py` — 按嵌入元数据改名](#rename_by_metadatapy--按嵌入元数据改名)
  - [`list_non_catalog.py` — 列出非 YT Music 编录的歌](#list_non_catalogpy--列出非-yt-music-编录的歌)
- [配置项 (`src/config.py`)](#配置项-srcconfigpy)
- [音频策略](#音频策略)
- [匹配分类体系](#匹配分类体系)
- [典型工作流](#典型工作流)
- [常见问题 (FAQ)](#常见问题-faq)
- [已知限制](#已知限制)
- [依赖](#依赖)

---

## 特性

| 模块 | 能力 |
|------|------|
| **搜索** | 调用 [`ytmusicapi`](https://github.com/sigma67/ytmusicapi),以 `filter="songs"` 命中 YT Music 正版编录,结构化元数据(title/artist/album/duration/videoId)直接拿到 |
| **筛选** | 跳过 karaoke / 伴奏 / 翻唱 / piano cover / 纯音乐 / 配乐 / MR;Live/Acoustic 降权但非必删 |
| **繁简归一** | opencc t2s,周杰倫↔周杰伦、孫燕姿↔孙燕姿 自动匹配 |
| **下载** | [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) `-f bestaudio` 取 opus 流(免费用户上限约 160 kbps),ffmpeg `-c copy` 把 webm 容器**无损重封装**为 `.opus` |
| **元数据** | yt-dlp `EmbedThumbnail` + `FFmpegMetadata`,封面/标题/艺人/专辑/发布日期一次写入 |
| **并发** | `ThreadPoolExecutor` 默认 3 路并发,失败 3 次指数退避(2s/8s/32s) |
| **断点续传** | `--resume` 跳过 `success.json` 已成功项 |
| **检查** | 把"用户期望"对比 yt-dlp 返回的"实际拿到",6 级分类(`ok` / `warn_alias_likely` / `warn_partial_artist` / `warn_title_diff` / `mismatch` / `ok_no_artist`),Medley/双语标题/罗马音艺名分别处理 |
| **整理** | 按分类挪进 `downloads/{cls}/` 子目录,幂等 |
| **改名** | 把不"完美匹配"的文件按嵌入元数据改成 `{真实艺人} - {真实标题}.opus`,挽救错位的命名 |
| **来源识别** | 用 YT 的 `Provided to YouTube by ...` 签名区分"正版编录" vs "普通视频 fallback" |

---

## 项目结构

```
YT_Music/
├── songs_list.txt              ← 原始歌单(每行 `歌名-艺人`)
├── requirements.txt
├── README.md                   ← 本文件
│
├── src/
│   ├── config.py               # 全局配置(格式、并发、过滤词、代理)
│   ├── parse_list.py           # 歌单解析(去重、艺人字段拆分)
│   ├── downloader.py           # 单首歌:搜索→筛选→下载→嵌元数据
│   ├── main.py                 # 批量入口(--test N / --all / --resume)
│   ├── check_matches.py        # 校验:请求 vs 实际,出 markdown 报告
│   ├── organize_by_check.py    # 把文件按分类挪进子目录
│   ├── rename_by_metadata.py   # 按嵌入元数据批量改名
│   └── list_non_catalog.py     # 找出非 YT Music 编录的下载
│
├── downloads/                  # 下载产物(.opus)
│   └── {Artist} - {Title}.opus
│
├── logs/
│   ├── success.json            # 已成功(断点续传依据)
│   ├── failed.json             # 失败明细(原因+建议)
│   ├── run_{timestamp}.log     # 完整运行日志
│   ├── match_report.md         # 匹配校验报告
│   └── non_ytmusic_report.md   # 非编录报告
│
└── cache/
    └── search_cache.json       # (预留)搜索结果缓存
```

---

## 环境准备

### 系统要求

- macOS / Linux(脚本里部分路径绝对路径写死了 macOS 用户目录,Linux 自行调整)
- Python ≥ 3.10
- `ffmpeg`(用于容器重封装和封面/元数据嵌入,**不**用于音频编解码)
- 能访问 YouTube(境内自行解决代理问题)

### 安装步骤

```bash
# 1. 装 ffmpeg(macOS)
brew install ffmpeg

# 2. 装 Python 依赖
pip install -r requirements.txt
```

`requirements.txt` 内容:
```
yt-dlp>=2026.3.17
mutagen>=1.47.0
ytmusicapi>=1.12.0
opencc-python-reimplemented>=0.1.7
```

---

## 快速开始

```bash
# 1. 把歌单放到项目根目录:songs_list.txt
#    格式:每行 `歌名-艺人`,详见[歌单格式]

# 2. 测试 10 首(固定 seed=42,可复现)
python src/main.py --test 10

# 3. 全量下载
python src/main.py --all

# 4. 中途打断,继续
python src/main.py --all --resume

# 5. 检查匹配质量
python src/check_matches.py

# 6. 按分类挪进子目录
python src/organize_by_check.py --apply

# 7. (可选)把所有非完美匹配的文件按嵌入元数据改名
python src/rename_by_metadata.py \
  --classes mismatch,warn_title_diff,warn_alias_likely,warn_partial_artist \
  --apply
```

---

## 歌单格式

`songs_list.txt`,**UTF-8 编码**,每行一首歌:

```
歌名-艺人
```

- 分隔符是**最后一个** `-`(因为有些歌名本身含 `-`)
- 多艺人用 ` _ `(空格-下划线-空格)分隔
- 缺艺人字段可以只写 `歌名-`(精度会下降,会被标 `ok_no_artist`)
- 中/英/日/韩混合都支持

示例:
```
起风了-买辣椒也用券
そばにいるね (留在我身边)-青山黛玛 _ SoulJa
Letting Go-汪苏泷 _ 吉克隽逸
スパークル [original ver.] -Your name. Music Video edition- 予告編 from new album「人間開花」初回盤DVD-RADWIMPS
Monica-
```

**已知数据质量陷阱**(脚本会尽力处理但不保证):
- 艺人/歌名写反(如 `いきものがかり-ブルーバード` 实际艺人是 `いきものがかり`,歌名是 `ブルーバード`)
- 含 `-` 的艺人名(如 A-Lin)会被错切分(`无人知晓的我-A-Lin` 会拆成 title=`无人知晓的我-A` artist=`Lin`),YT 搜索的容错通常能救回来
- 完全相同歌名+不同艺人,脚本会保留全部(如 `离别的车站-赵薇` 和 `离别的车站-卓依婷`)

解析器会自动:
- 去重(标题+艺人归一化匹配)
- 软去重(同标题既有"无艺人"版本又有"带艺人"版本时,丢前者)

---

## 详细用法

### `main.py` — 批量下载

```
usage: main.py [-h] (--test N | --all) [--resume] [--limit LIMIT]

Required:
  --test N         随机抽 N 首测试(固定 seed,可复现)
  --all            下载全部
  
Optional:
  --resume         跳过 success.json 里已成功的(断点续传)
  --limit N        总数限制(调试用)
```

**单首歌的完整流程**:

```
歌单行 → 解析 title/artists → ytmusicapi.search(filter="songs")
       → pick_best(过滤 karaoke/伴奏/Piano/降权 Live)
       → yt-dlp(-f bestaudio,opus 优先)
       → ffmpeg(-c copy,webm→opus 重封装)
       → 嵌入 metadata + 封面
       → 写入 success.json
```

**失败兜底**:
- ytmusicapi 找不到 → 回退 `yt-dlp ytsearch` 普通 YouTube 搜索
- 网络/429 → 3 次重试,2s/8s/32s 指数退避
- 全部失败 → 写入 `failed.json`,继续下一首

**典型耗时**:1106 首 × 平均 2.3 秒/首 / 并发 3 ≈ **15 分钟**(网速好)。

---

### `check_matches.py` — 匹配校验

对比"用户请求"和"实际下载到的内容",出一份分级 markdown 报告。

```
usage: check_matches.py [-h] [--check-files] [-o OUT]

Optional:
  --check-files    额外读磁盘 .opus 文件的内嵌元数据(慢但更准)
  -o OUT           报告输出路径,默认 logs/match_report.md
```

**判定原理**(详见 [匹配分类体系](#匹配分类体系)):

1. **title_similarity**: 对请求和匹配标题分别剥离括号注解、` - 罗马音`后缀,opencc 繁简归一,再算 `difflib.SequenceMatcher.ratio()`,取最大值
2. **artist_match**: 归一化后做 substring 双向比对
3. **medley 检测**: 关键词 `Medley/连环炮/串烧/组曲` 或括号外 ≥2 个 `/` 分隔符
4. **classify**: 综合 sim + 艺人匹配 + medley 标记,给出 6 级标签

---

### `organize_by_check.py` — 按分类挪文件

把 `downloads/` 里的文件按 `check_matches` 的分类挪进子目录,**幂等**(可重复跑):

```
usage: organize_by_check.py [-h] [--apply] [--copy] [--dry-run]

Optional:
  --apply          实际执行(默认 dry-run)
  --copy           复制而非移动(配合 --apply)
```

**结果布局**:
```
downloads/
├── ok/                          ✅ 艺人+标题都对
├── warn_alias_likely/           🔵 标题完全一致艺人字面不同(罗马音/艺名)
├── warn_partial_artist/         ⚠️ 艺人字符部分相交
├── warn_title_diff/             ⚠️ 艺人对但标题差异大
├── mismatch/                    ❌ 真错了,优先 review
└── ok_no_artist/                🟡 歌单原始缺艺人字段
```

---

### `rename_by_metadata.py` — 按嵌入元数据改名

把文件名改成 `{文件内嵌真实艺人} - {真实标题}.{ext}`。

**用途**: mismatch / warn_* 的文件原本以"用户期望的艺人/标题"命名,但实际下载到的可能是另一首歌。改名后文件名和内容一致。

```
usage: rename_by_metadata.py [-h] [--classes CLASSES | --dir DIR] [--apply] [--recursive]

两种模式(互斥):
  --classes CLASSES    通过 success.json + check_matches 反查指定分类的文件
                       默认: mismatch
                       可逗号分隔: --classes mismatch,warn_title_diff
  --dir DIR            指定目录,把里面所有音频按嵌入元数据改名

Optional:
  --apply              实际执行(默认 dry-run)
  --recursive          (仅 --dir)递归子目录
```

**示例**:

```bash
# 只改 mismatch
python src/rename_by_metadata.py --apply

# 把所有非 ok 的都改了
python src/rename_by_metadata.py --apply \
  --classes mismatch,warn_alias_likely,warn_partial_artist,warn_title_diff,warn_no_artist,warn_title_only,ok_no_artist

# 不依赖 success.json,直接对某个目录无脑改
python src/rename_by_metadata.py --dir downloads --recursive --apply
```

**会跳过**:
- 计算出的新文件名 = 当前名(无需改动)
- success.json 引用的文件已不在磁盘上(被删/已改名)— 安静跳过
- 同目录已存在同名目标文件 — 加 ` (2)`、` (3)` 后缀避免覆盖

---

### `list_non_catalog.py` — 列出非 YT Music 编录的歌

YT Music 的正版编录由后台自动的 *Topic* 频道发布,YouTube 自动生成的描述里一定带 `Provided to YouTube by {厂牌}` 起、`Auto-generated by YouTube.` 收。普通视频(MV/Live/翻唱/用户上传)不会有这个签名。

本工具用这个签名作为"金标准"区分:

```
usage: list_non_catalog.py [-h] [-o OUT] [--include-no-album]

Optional:
  --include-no-album   把缺 album 字段的编录条目也列出来(可能是厂牌没填全)
  -o OUT               报告输出路径,默认 logs/non_ytmusic_report.md
```

输出报告分三类:
- ✅ **catalog**: 正版编录
- 🟡 **catalog_no_album**: 是编录但 album 字段空
- ❌ **non_catalog**: 普通视频 / fallback(需要人工 review)

---

## 配置项 (`src/config.py`)

```python
# 路径
PROJECT_ROOT, DOWNLOADS_DIR, LOGS_DIR, CACHE_DIR, SONGS_LIST
SUCCESS_LOG = LOGS_DIR / "success.json"
FAILED_LOG  = LOGS_DIR / "failed.json"

# 下载格式
FORMAT_PREFERENCE = "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio"
EMBED_THUMBNAIL   = True   # 嵌入封面
EMBED_METADATA    = True   # 嵌入歌名/艺人/专辑

# 并发与重试
CONCURRENT_DOWNLOADS = 3
RETRY_TIMES          = 3
RETRY_BACKOFF        = [2, 8, 32]  # 秒

# 标题黑名单(命中即跳过)
SKIP_KEYWORDS = [
    "karaoke", "伴奏", "off vocal", "off-vocal", "(mr)", " mr ", "mr版",
    "cover by", "翻唱", "翻唱版",
    "piano cover", "piano version", "piano ver.", "piano ver",
    "钢琴版", "鋼琴版", "钢琴cover", "钢琴 cover",
    "纯音乐", "純音樂", "纯钢琴", "純鋼琴",
    "instrumental", "纯伴奏", "純伴奏",
    "nightcore", "mmd", "8d audio", "sped up", "slowed",
    "配樂", "配乐",
]

# 艺人黑名单(艺人名子串命中即跳过)
SKIP_ARTIST_KEYWORDS = [
    "纯音乐", "純音樂",
    "配樂", "配乐",
    "karaoke", "instrumental",
    "music for u", "zzang karaoke",
]

# 标题降权词(-15 分,但同艺人无 studio 版仍会被选)
DEPRIORITIZE_KEYWORDS = [
    "live", "acoustic", "demo", "remix",
    "现场", "原声",
    "rehearsal", "reprise", "extended",
]
DEPRIORITIZE_PENALTY = 15

# 时长合理范围(秒)
DURATION_MIN_SEC = 30
DURATION_MAX_SEC = 1200

# 搜索候选数
SEARCH_LIMIT = 5

# 网络
PROXY                  = None    # 例: "http://127.0.0.1:7890" / "socks5://..."
COOKIES_FROM_BROWSER   = None    # 例: "chrome" — 拿 YT Music Premium 256kbps AAC

# 测试随机种子
TEST_SEED = 42
```

---

## 音频策略

**核心原则:不做任何有损二次转码。**

YouTube 服务端给免费用户的音频流有两种容器:
- `.webm` 内含 **opus** 编码(~160 kbps)
- `.m4a` 内含 **AAC** 编码(~128 kbps)

本项目优先取 opus(音质更好),因为 `EmbedThumbnail` 后处理器不支持 `.webm` 容器,我们用 `FFmpegVideoRemuxer` 把 webm → opus(Ogg 容器),这是**单纯换容器,ffmpeg `-c copy`,bit-for-bit 保留音频**,不重新编码。

如果有 YouTube Music Premium 账号:
- 在 `config.py` 设 `COOKIES_FROM_BROWSER = "chrome"`
- 浏览器登录 YT Music Premium
- 可拿到 **256 kbps AAC**

切回 m4a 优先(更通用,老设备友好):
```python
FORMAT_PREFERENCE = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
```

---

## 匹配分类体系

`check_matches.py` 把每首歌的"请求"和"实际匹配"按下面规则归类:

| 标签 | 含义 | 触发条件 |
|------|------|----------|
| ✅ `ok` | 艺人+标题都对 | artist=exact, title_sim ≥ 0.55 |
| 🟡 `ok_no_artist` | 歌单原始缺艺人,只能按标题判断 | requested artists 为空, sim ≥ 0.7 |
| 🔵 `warn_alias_likely` | 艺人字面不同但标题完全一致 | astat=none, sim ≥ 0.92;或 astat=exact 且请求标题是匹配标题的子串且非 medley |
| ⚠️ `warn_partial_artist` | 艺人字符仅部分相交 | astat=partial |
| ⚠️ `warn_no_artist` | YT 返回的艺人为空 | astat=no_matched |
| ⚠️ `warn_title_only` | 歌单缺艺人 + 标题也对不太上 | requested 为空,sim < 0.7 |
| ⚠️ `warn_title_diff` | 艺人对但标题差异大且非"内嵌子串" | astat=exact, sim < 0.55, 非子串或 medley |
| ❌ `mismatch` | 艺人不同 + 标题也明显不同 | astat=none, sim < 0.92, 非子串或 medley |

**medley 检测**:防止"金曲连环炮"这种串烧因为包含目标歌名就被误判为同曲:
- 关键词: `Medley`、`Mix`、`组曲`、`串烧`、`連環炮` 等
- 括号外有 ≥2 个 `/` 分隔符

**标题归一化**: 对请求和匹配标题都剥离以下内容再算相似度
- 括号注解 `()` / `（）` / `[]` / 【】
- ` - {罗马音/副标题}` 尾巴(YT Music 常加)
- opencc 繁→简

---

## 典型工作流

### 1. 第一次跑完整流程

```bash
# (0) 准备 songs_list.txt 到项目根

# (1) 测试 10 首,确保环境 OK
python src/main.py --test 10

# (2) 全量
python src/main.py --all

# (3) 校验
python src/check_matches.py

# (4) 看报告 logs/match_report.md,重点 review ❌ mismatch

# (5) 按分类挪
python src/organize_by_check.py --apply

# (6) (可选)所有非 ok 的按嵌入元数据改名
python src/rename_by_metadata.py --apply \
  --classes mismatch,warn_alias_likely,warn_partial_artist,warn_title_diff

# (7) (可选)检查是否有 fallback 到普通视频的
python src/list_non_catalog.py
```

### 2. 中途打断 → 续跑

```bash
python src/main.py --all --resume
```

### 3. 追加歌曲

向 `songs_list.txt` 追加新行,直接:
```bash
python src/main.py --all --resume   # 自动跳过已下载
python src/check_matches.py
python src/organize_by_check.py --apply
```

### 4. 修改过滤规则后,重新评估匹配

不需要重下,只改 `config.py` 的 `SKIP_KEYWORDS` / `SKIP_ARTIST_KEYWORDS` / `DEPRIORITIZE_KEYWORDS` 等 → 不影响已下载文件,但**会影响新下载的搜索结果**;`check_matches.py` 的分类逻辑是写死在 `check_matches.py` 里的,改它直接重跑即可。

### 5. 删除某些歌后,重整理

文件 ad-hoc 删除 / 改名后,直接重跑 `check_matches.py` + `organize_by_check.py`,工具会幂等地处理(找不到的文件安静跳过)。

---

## 常见问题 (FAQ)

**Q: 中国大陆能用吗?**  
A: 能,但需要代理。在 `config.py` 设:
```python
PROXY = "http://127.0.0.1:7890"   # 或者 socks5://127.0.0.1:1080
```

**Q: 报错 `ERROR: Postprocessing: Supported filetypes for thumbnail embedding are: mp3, mkv/mka, ogg/opus/flac, m4a/mp4/m4v/mov`**  
A: 这说明 webm→opus 重封装没生效。检查 `downloader.py` 的 `_build_ydl_opts`,确认 `FFmpegVideoRemuxer` postprocessor 在 `EmbedThumbnail` 之前。

**Q: 报错 `ytmusicapi songs-search failed`**  
A: 多半是网络问题,代理没配好。或者 ytmusicapi 版本过旧:
```bash
pip install -U ytmusicapi
```

**Q: 想要 mp3 输出而不是 opus?**  
A: 默认保留原始流(opus/m4a)。如非要 mp3:在 `downloader.py` 的 postprocessor 加 `FFmpegExtractAudio`:
```python
postprocessors.append({
    "key": "FFmpegExtractAudio",
    "preferredcodec": "mp3",
    "preferredquality": "320",
})
```
**但这是有损二次编码**,会损失音质。

**Q: 怎么强制重新下载某首歌?**  
A: 删掉 `success.json` 里对应那条,再 `--resume`。或者直接删掉对应的 `.opus` 文件并把那条从 success.json 移除。

**Q: 怎么知道某首歌下到的是不是正版?**  
A: 跑 `list_non_catalog.py`,看 `non_catalog` 那一类。

**Q: 删了原文件夹的分类子目录怎么办?**  
A: 没事,所有脚本都是幂等的。文件平铺在 `downloads/` 根目录依然能跑。`check_matches.py` 依赖 `success.json` 不依赖文件位置;`organize_by_check.py` 会重新挪。

---

## 已知限制

1. **歌单数据反向**: 部分歌单条目把艺人写在前歌名在后(如 `いきものがかり-ブルーバード`),脚本按"最后一个 `-` 切分"规则会反着切。YT 搜索的容错通常能救回来,但 metadata 里的"请求字段"是反的,`check_matches.py` 会把它判为 mismatch。
2. **含 `-` 的艺人名**: `A-Lin`、`F.I.R.` 等含 `-`/`.` 的艺人会被解析器切错。同上,YT 搜索容错通常能救。
3. **单字标题**: 1 字标题(如"溯"、"哇")在 `check_matches.py` 的子串检测里被跳过(`len(a) < 2`),会落到 mismatch。需要人工 review。
4. **跨语言同曲**: 如 `金达莱花-Maya` 实际下到的是 `Azalea (진달래꽃)` by MAYA(韩文原版),脚本无法自动识别这是同首歌。会落到 `warn_title_diff`。
5. **不下载非编录的特定版本**: 用户写 `必杀技 (DJ阿卓版)` 期望 DJ 版,但 YT Music 没有,只下到了普通版。
6. **YT Music API 不稳定**: ytmusicapi 用的是 YT Music 的私有接口,YouTube 改后端可能造成短时间内不可用,需要等 ytmusicapi 升级。
7. **音质上限受账号影响**: 无 Premium 账号上限是 opus ~160 kbps。

---

## 依赖

| 工具 | 版本 | 角色 |
|------|------|------|
| Python | ≥ 3.10 | 主语言 |
| ffmpeg | ≥ 7.x | 容器封装、metadata 写入(不做编解码) |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | ≥ 2026.3.17 | 下载内核 |
| [ytmusicapi](https://github.com/sigma67/ytmusicapi) | ≥ 1.12.0 | YT Music 私有 API 客户端 |
| [mutagen](https://github.com/quodlibet/mutagen) | ≥ 1.47.0 | 元数据读写(Vorbis Comments / MP4) |
| [opencc-python-reimplemented](https://pypi.org/project/opencc-python-reimplemented/) | ≥ 0.1.7 | 繁→简归一化 |

---

## License

仅供个人学习使用,请遵守 YouTube 服务条款,不要用于商业用途或大规模分发。
