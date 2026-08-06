# YT_Music UI 实现策略:是否保留 Python 后端

> 版本:v1.0(已确认)  日期:2026-08-06  分支:`feat/ui-integration`
> 依赖:`01-requirements.md`、`02-tech-stack.md`、`04-implementation-details.md`
> 状态:✅ 最终决策为 **路径 B+**(见 §3)。本文档保留了三路径的对比分析供回顾。

用户反馈:**"如果你有更好的方式实现现在的功能,可以不考虑现有的 Python 作为后端。
我要的是这个工具能实现现在的功能,并不是完全使用现在的脚本。但要先说明现在的功能通过什么形式实现,以及有啥好处。"**

本文档回答两件事:① 现有功能在新方案里靠什么实现;② 这样做的好处。

---

## 1. 先厘清:现有 11 个脚本到底"硬依赖"什么

逐个拆解。关键看每个脚本依赖的库**是否有非 Python 替代品**。

| 现有脚本 | 核心功能 | 真正的依赖 | 依赖性质 | 能否离开 Python |
|----------|----------|-----------|----------|-----------------|
| `downloader.py` | 搜索 + 下载 | **`ytmusicapi`**(搜 YT Music 目录)<br>**`yt-dlp`**(下载)<br>`opencc`(繁简) | ytmusicapi:Python 独占<br>yt-dlp:有独立二进制<br>opencc:有 Rust/JS 绑定 | ⚠️ 见下 |
| `parse_list.py` | 歌单文本解析 | 纯字符串处理 | 无外部依赖 | ✅ 任何语言都能重写 |
| `check_matches.py` | 匹配质量校验(相似度/分类) | `difflib`(标准库) | 算法通用 | ✅ Rust `strsim` / JS `string-similarity` |
| `organize_by_check.py` | 按分类挪文件 | 文件移动 + `mutagen`(读元数据) | mutagen→Rust `lofty` / JS `music-metadata` | ✅ |
| `rename_by_metadata.py` | 按元数据改名 | `mutagen` | 同上 | ✅ |
| `list_non_catalog.py` | 识别正版编录 | `mutagen` + 字符串签名匹配 | 同上 | ✅ |
| `opus2mp3.py` | opus→mp3 转码 | **`ffmpeg` 子进程** + `mutagen` | ffmpeg 本就是独立二进制 | ✅ |
| `download_from_urls.py` | URL 直下 | **`yt-dlp`** | 二进制 | ✅ 调子进程 |
| `export_cookies.py` | 浏览器 cookies 导出 | `browser_cookie3` | Rust `browsercookie` / 直接读 SQLite | ✅ |
| `shuffle_rename.py` | 文件名加随机前缀 | 纯文件重命名 | 无外部依赖 | ✅ |
| `find_duplicates.py` | 跨源去重 | 纯逻辑 | 无外部依赖 | ✅ |

### 结论:11 个脚本里,只有 1.5 个"真·离不开 Python"

- **离不开的只有 `ytmusicapi`**——它是唯一一个反向工程 YT Music 私有 API、提供 `filter="songs"` 精准命中正版目录能力的库,任何其他语言都没有等价物。
- **`yt-dlp` 名义上是 Python,但官方发布单文件独立二进制**(Windows 的 `yt-dlp.exe`、Unix 的 `yt-dlp`),任何语言都能当子进程调用。**它本来就必须随软件分发**(它是唯一能可靠下载 YT 的东西),所以"是不是 Python 写的"对用户透明——它就是一个 exe。
- **其余 9 个脚本的逻辑**(解析/相似度/分类/文件操作/转码调度/cookies),全是通用算法,在 Rust/TS 里有成熟等价物,**重写是机械工作,不损失任何能力**。

> 关键洞察:**下载内核(yt-dlp)无论选什么方案都必须打包;唯一的真问题是"搜索那一步要不要保留 ytmusicapi"。**

---

## 2. 现有功能在新方案里分别靠什么实现

把需求文档 §3 的每个功能,映射到"无 Python"方案下的实现:

### 2.1 搜索 + 下载(D 页核心)

| 子能力 | 现状(Python) | 新方案实现 |
|--------|---------------|-----------|
| YT Music 搜索 | `ytmusicapi.search(filter="songs")` | **`yt-dlp "ytsearch5:标题 艺人" --dump-json`**(yt-dlp 自带搜索,返回结构化 JSON: title/artist/duration/view_count) |
| 候选筛选/打分(pick_best) | Python 逻辑 | **TS 重写**(纯算法:关键词黑名单、时长过滤、艺人匹配打分) |
| 下载音频流 | `yt-dlp` Python lib | **`yt-dlp` 二进制子进程**(Tauri Command 拉起,读 stdout/stderr 流式拿进度) |
| webm→opus 重封装 | `ffmpeg -c copy` | **`ffmpeg` 二进制子进程**(完全一样) |
| 嵌入封面/元数据 | yt-dlp postprocessor | 同上,yt-dlp 的 `--embed-metadata --embed-thumbnail` |
| 繁简归一 | `opencc` Python | **Rust `opencc-rust` 绑定** 或 TS 端加载词典 |

> ⚠️ **唯一的真实代价**:yt-dlp 的 `ytsearch` 不如 ytmusicapi 的 `filter="songs"` 精准。
> 但 **`check_matches.py` 的 8 级分类体系本来就是为"兜底搜索不准"而生的质量闸**——
> 把它忠实移植到 TS,搜索精度的差异会被分类逻辑捕获并暴露给用户 review,不掩盖问题。
> (后面 §5 给"想要极致精度"的可选增强。)

### 2.2 匹配校验(R 页)

| 子能力 | 新方案实现 |
|--------|-----------|
| 标题相似度 | TS `string-similarity` 或自写 SequenceMatcher(几十行) |
| 艺人匹配(exact/partial/none) | TS 纯逻辑移植 |
| Medley/串烧检测 | 正则,TS 原生支持 |
| 8 级分类 | 纯规则,TS 移植 |
| 读磁盘元数据(--check-files) | **Rust `lofty` crate**(经 Tauri Command 调用,读 opus/m4a 标签和封面) |

### 2.3 文件整理 / 改名 / 目录浏览(O 页)

全用 **Tauri 文件系统 API**(`fs` plugin)+ Rust 侧 `lofty` 读元数据。无 Python。

### 2.4 来源识别(C 页)

"Provided to YouTube by" 签名匹配 = 读音频内嵌 description/synopsis 字段 + 字符串包含判断。Rust `lofty` 读字段,TS 做匹配。无 Python。

### 2.5 URL 直下(U 页)

`yt-dlp` 子进程 + 流式进度。无 Python。

### 2.6 转码(T 页 opus2mp3)

`ffmpeg` 子进程 + Rust `lofty` 拷标签/封面到 mp3 的 ID3。**和现在的 Python 版本做的事一模一样,只是宿主语言换了。**

### 2.7 Cookies 导出(设置页)

- 浏览器提取:Rust 侧直接读 Chrome/Firefox 的 SQLite cookie 库(解密用系统 keychain),或用 `browsercookie` crate。
- 手动文件:直接读 `cookies.txt`,传给 yt-dlp 的 `--cookies` 参数。
- 有效性测试:跑一次 `yt-dlp --dump-json` 单首搜索,看返回。

### 2.8 配置持久化

`config.user.json`,Tauri 直接读写文件系统。无 Python。

### 2.9 实时进度 / 日志

yt-dlp/ffmpeg 子进程的 stdout/stderr 通过 Tauri 的 `Command::new().spawn()` 流式读,
经 Tauri 的 **Event 系统** 推到前端(等价 WebSocket,但走 IPC,零网络开销)。

---

## 3. 三条实现路径

| | 路径 A:保留 Python 后端 | 路径 B:TS 全栈 + 打包二进制 ⭐推荐 | 路径 C:Python 瘤子(只留 ytmusicapi) |
|---|---|---|---|
| **后端语言** | Python(FastAPI) | **TypeScript(逻辑)+ Rust(薄壳,~50 行)** | Rust/TS + 一个 Python 小脚本 |
| **搜索** | ytmusicapi | **yt-dlp ytsearch**(略逊) | ytmusicapi(经子进程) |
| **下载** | yt-dlp(Python import) | **yt-dlp 二进制子进程** | yt-dlp 子进程 |
| **其余逻辑** | 现有脚本不改 | **TS 重写**(解析/分类/整理/转码调度) | Rust/TS 重写 |
| **要打包的运行时** | Python 解释器 + 全部 pip 依赖 | **无**(yt-dlp 单文件二进制 + ffmpeg) | Python 解释器(为 1 个功能) |
| **安装包体积** | 60-100MB+ | **15-25MB**(+yt-dlp ~30MB 可选内置) | 50-80MB |
| **代码统一性** | 三语言(Python+Rust+TS) | **两语言但 Rust 不可见**(全 TS) | 三语言 |
| **开发速度** | 快(复用现有) | 中(重写逻辑,但算法清晰) | 慢(最尴尬) |
| **维护成本** | 高(三套构建) | **低**(一套 Cargo+npm) | 高 |
| **搜索精度** | 最高 | 中(靠分类逻辑兜底) | 最高 |
| **跨平台打包坑** | 多(C 扩展/wheel/glibc) | **少**(只有原生二进制) | 多 |

---

## 4. 推荐:路径 B(TS 全栈 + 打包 yt-dlp/ffmpeg 二进制)

### 架构

```
┌──────────────────────────────────────────────────────────┐
│  Tauri 应用                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  前端 + 应用逻辑:React + TypeScript                 │  │
│  │  (UI、歌单解析、相似度、分类、cookies 解析、        │  │
│  │   转码/改名/整理的"调度逻辑"全在这里)              │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │ Tauri IPC(命令 + 事件)          │
│                        ▼                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Rust 薄壳(~200 行,几乎全是模板):                 │  │
│  │  - spawn yt-dlp / ffmpeg 子进程,流式读 stdout      │  │
│  │  - fs 操作(读元数据用 lofty、移动/改名)          │  │
│  │  - 事件推送进度到前端                              │  │
│  │  - opencc 繁简(可选 binding)                     │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        ▼ 子进程                            │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │ yt-dlp 二进制│  │ ffmpeg 二进制│  (随应用分发)        │
│  └──────────────┘  └──────────────┘                       │
└──────────────────────────────────────────────────────────┘
```

### 为什么推荐 B

**1. 彻底干掉"打包 Python 桌面应用"这整个痛点类别。**
桌面 Python 应用最大的工程噩梦不是写代码,是分发:
opencc/mutagen/yt-dlp 带的 C 扩展、跨平台 wheel、Linux 的 glibc/musl、
macOS 的 arm64/x64 双架构、Windows 的 VC 运行时……每个都是真实的踩坑点。
**路径 B 让这些全部消失**——只剩两个原生二进制(yt-dlp、ffmpeg),操作系统直接执行。

**2. 一套语言写整个应用。**
TS 写 UI,也写"后端逻辑"(解析、分类、调度)。Rust 层是 Tauri 模板代码,
对应用开发者基本透明。心智负担 = 一个生态。对比路径 A 的 Python+Rust+TS 三栈,维护成本断崖式下降。

**3. 体积小一个数量级。**
路径 A 要带整个 CPython 解释器 + 全部依赖,起步 60MB。
路径 B 的应用本体 ~15-25MB;yt-dlp 是单文件 ~30MB(可内置可外置);ffmpeg 用户自备或内置。
**最终安装包可以做到 40-50MB,且无运行时依赖。**

**4. 进度推送更原生。**
Tauri 的 Event 系统直接走 IPC,比 FastAPI + WebSocket 少一层网络栈,
延迟更低、无端口占用(不用在用户机器上开 8765 端口)。

**5. 现有逻辑的"算法价值"被保留,只是换了宿主。**
`check_matches.py` 的相似度算法、8 级分类、medley 检测、`pick_best` 的打分——
这些是工具的"大脑",TS 移植后行为一致。被丢弃的只是"Python 胶水",胶水本来就不该是产品价值。

### 代价(诚实说)

1. **要重写约 800-1200 行 Python 逻辑到 TS。** 工作量集中在 `check_matches`(分类+相似度)、`parse_list`、`pick_best`、`opus2mp3` 调度、cookies 解析。都是确定性算法,无外部依赖,移植风险低。
2. **搜索精度从"ytmusicapi 高"降到"yt-dlp ytsearch 中"。** 落差会被分类逻辑兜住,但理想情况下完美匹配率可能从 66% 略降。**缓解见 §5。**
3. **首次开发比路径 A 慢**(路径 A 复用现成代码)。但一次性付出,长期收益。

---

## 5. 搜索精度的可选增强(给在意质量的用户)

如果路径 B 上线后发现搜索精度不够,有两个递进补救:

1. **yt-dlp 的 YouTube Music 提取器**:yt-dlp 近年持续增强 YT Music 支持,`yt-dlp` 能直接搜 YT Music 的歌曲分类(比通用 ytsearch 更靠近目录)。优先用这个。
2. **可选的"高精度搜索"插件**:把 ytmusicapi 包成一个 ~30 行的 Python 小脚本作为**可选子进程**(用户装了 Python 才启用,不装就走 yt-dlp 默认)。把"极致精度"做成 opt-in,不强制所有用户背 Python 运行时。

这样默认分发保持纯净,需要精度的用户可一键启用增强。

---

## 6. 三个路径的搜索/下载能力对照(关键)

| 能力 | 路径 A(保留 Python) | 路径 B(TS 全栈) |
|------|----------------------|------------------|
| 搜 YT Music 正版目录 | ✅ ytmusicapi 精准 | ⚠️ yt-dlp ytsearch(够用,略逊) |
| 下载音频流 | ✅ | ✅(同一个 yt-dlp) |
| 匹配校验 8 级分类 | ✅ | ✅(TS 移植,行为一致) |
| opus/m4a 元数据读写 | ✅ mutagen | ✅ Rust lofty |
| ffmpeg 转码 | ✅ | ✅(同一个 ffmpeg) |
| cookies 管理 | ✅ | ✅ |
| 繁简归一 | ✅ opencc | ✅ opencc 绑定 |
| 跨平台分发干净度 | ❌ Python 打包痛 | ✅ 原生二进制 |

**结论:路径 B 在"功能完整性"上与 A 持平,只在"搜索精度"上有可控落差,换来分发与维护的巨大简化。**

---

## 7. 已确认决策

**用户选择路径 B+**(2026-08-06)。

即:**TS 全栈主体 + yt-dlp/ffmpeg 原生二进制 + 可选 ytmusicapi 插件**。
默认分发纯净(无 Python 运行时),在意搜索精度的用户装 Python 后启用高精度搜索。
逐功能实现见 `04-implementation-details.md`,落地计划见 `05-development-plan.md`。
