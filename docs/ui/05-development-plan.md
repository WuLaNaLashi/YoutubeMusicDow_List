# YT_Music UI 开发落地计划

> 版本:v1.0  日期:2026-08-06  分支:`feat/ui-integration`
> 依赖:`01-requirements.md`、`02-tech-stack.md`、`03-implementation-strategy.md`、`04-implementation-details.md`、`prototype/`
> 状态:**可执行蓝图**。本文档把前 4 份决策文档 + 原型,翻译成可执行的开发任务序列。

---

## 0. 锁定的技术栈(不再变)

| 层 | 技术 |
|----|------|
| 桌面壳 | **Tauri 2.x**(Rust 主进程) |
| 前端 | **React 18 + TypeScript + Vite** |
| UI | **shadcn/ui + Tailwind CSS** |
| 应用逻辑 | **TypeScript**(跑在 WebView,经 Tauri Command 调 Rust) |
| Rust 薄壳 | ~200~400 行(spawn yt-dlp/ffmpeg、文件操作、`lofty` 读元数据、事件推送) |
| 下载内核 | **yt-dlp 二进制子进程** |
| 转码内核 | **ffmpeg 二进制子进程** |
| 高精度搜索(可选) | **ytmusicapi Python 小脚本**(opt-in 插件) |
| 配置 | `config.user.json` 覆盖 `config.py` 默认 |
| 分发 | electron-builder→**tauri bundler**:Win `.exe` / mac `.dmg` / Linux `.AppImage` |

**当前环境检查(2026-08-06):**
- ✅ Node v22.23.1、npm 10.9.8、ffmpeg 7.1.1
- ❌ **Rust/cargo 未装**(Tauri 必需)→ 计划第 0 步装
- ❌ **yt-dlp 未装**(下载内核)→ 计划第 0 步装
- ❌ deno 未装(yt-dlp 解 JS 挑战用)→ 计划第 0 步装

---

## 1. 工程结构(开发阶段落地)

```
YoutubeMusicDow_List/
├── src/                       # 现有 Python 脚本(保持不变,B+ 下仅 ytmusicapi 插件用)
├── ui/                        # ⭐ 新增:Tauri 应用
│   ├── src-tauri/             # Rust 主进程
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   ├── src/
│   │   │   ├── main.rs        # Tauri 入口 + 命令注册
│   │   │   ├── process.rs     # spawn yt-dlp/ffmpeg + 流式进度(模板代码)
│   │   │   ├── fs_ops.rs      # 文件操作(移动/改名/目录浏览)
│   │   │   ├── metadata.rs    # lofty 读写元数据/封面
│   │   │   ├── cookies.rs     # 浏览器 cookies 提取
│   │   │   └── sidecar.rs     # 找 yt-dlp/ffmpeg 二进制路径(内置或 PATH)
│   │   └── binaries/          # 内置的 yt-dlp 二进制(按平台)
│   │
│   ├── src/                   # React 前端
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/             # 8 页:Download/Review/Organize/Catalog/Urls/Tools/Settings/Help
│   │   ├── components/        # shadcn/ui + 自定义组件
│   │   ├── lib/               # ⭐ 应用逻辑(TS 移植自 Python)
│   │   │   ├── parseList.ts        # parse_list.py 移植
│   │   │   ├── pickBest.ts         # downloader.pick_best 移植
│   │   │   ├── checkMatches.ts     # check_matches.py 移植(8 级分类,核心)
│   │   │   ├── similarity.ts       # SequenceMatcher / medley 检测
│   │   │   ├── opencc.ts           # opencc-js 繁简
│   │   │   ├── search.ts           # 调 yt-dlp ytsearch / 可选 ytmusicapi
│   │   │   ├── confidence.ts       # ⭐ D-10/D-11 置信度打分(新增逻辑)
│   │   │   └── config.ts           # config.user.json 读写
│   │   ├── api/               # Tauri Command 封装(invoke + listen)
│   │   ├── stores/            # Zustand(任务/配置/进度状态)
│   │   └── i18n/              # 文案(首版中文,预留英)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
│
├── plugins/                   # ⭐ 可选 Python 插件
│   └── ytmusic_search/        # ytmusicapi 包装(B+ 的 opt-in 部分)
│       ├── search.py          # ~30 行:stdin JSON → stdout JSON
│       └── README.md
│
├── prototype/                 # HTML 原型(已完成,作为 UI 规格)
├── docs/ui/                   # 本文档系列(已完成 01~05)
├── config.py                  # 现有(保持,作为默认值源)
└── config.user.json           # ⭐ 新增(UI 写,gitignore)
```

---

## 2. 开发阶段划分(MVP 优先)

按"能跑起来 → 补全功能 → 打磨分发"三阶段。

### 阶段 0:环境准备 ⏱️ 10 分钟

| 步骤 | 命令/操作 |
|------|----------|
| 装 Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`(macOS/Linux);Windows 用 rustup-init.exe |
| 装 yt-dlp | `brew install yt-dlp`(macOS)/ `pipx install yt-dlp` / 官方 release 二进制 |
| 装 deno | `curl -fsSL https://deno.land/install.sh \| sh` |
| 验证 | `cargo --version && yt-dlp --version && deno --version` |

### 阶段 1:工程骨架 + 单首歌端到端打通 ⏱️ 目标:能下 1 首

> 目的:把"Tauri 壳 → spawn yt-dlp → 进度回前端"这条主干跑通,其余都是填充。

1. **`npm create tauri-app@latest`** 选 React + TS,生成 `ui/` 骨架。
2. 装 shadcn/ui + Tailwind:`npx shadcn-ui@latest init`。
3. **Rust 侧写 `process.rs`**(~80 行):
   - `#[tauri::command] async fn run_ytdlp(args, on_event, app) -> Result<...>`
   - spawn `yt-dlp ... --newline --progress-template`,逐行读 stdout,`app.emit()` 推前端。
4. **前端最小页**:一个输入框(URL)+ 按钮 + 进度条 + 日志。
   - `invoke('run_ytdlp', {...})` + `listen('ytdlp-progress', ...)`。
5. **验证**:输入一个 YT URL,看到进度条动 + opus 文件落盘。

✅ **阶段 1 验收:单首 URL 能下,进度实时显示。** 对应原型 U 页 + 部分基础设施。

### 阶段 2:下载主线(D 页全功能)⏱️ 核心

移植 Python 逻辑到 TS,实现 D-1~D-12。

6. **`lib/parseList.ts`**:移植 `parse_list.py`(30 行,见 `04` §功能 1)。
7. **`lib/opencc.ts`**:集成 `opencc-js`。
8. **`lib/search.ts`**:
   - 默认:`run_ytdlp(['ytsearch5:...', '--flat-playlist', '--dump-json'])`。
   - 可选:检测 `plugins/ytmusic_search/` + Python 可用 → 用它(精度高)。
9. **`lib/pickBest.ts`**:移植 `downloader.pick_best`(70 行,见 `04` §功能 3)。
10. **`lib/confidence.ts`** ⭐ 新增:在 pickBest 打分基础上,输出三档置信度 + 存疑原因(命中 MV/Live/Medley/翻唱、艺人不匹配等)。这是 D-10/D-11 的核心,原型已演示。
11. **`stores/taskStore.ts`**:任务系统(Zustand)——下载批次、并发控制(`p-limit`)、停止、断点续传(读写 `success.json`)。
12. **D 页 UI**:照原型实现——歌单编辑器、目录选择(D-9)、质量策略下拉(D-11)、进度条、明细表(置信度列 D-10)、候选确认弹层(D-11)、待确认队列(D-12)。

✅ **阶段 2 验收:歌单 → 全量下载 → 存疑弹确认 → 断点续传,全流程跑通。**

### 阶段 3:校验 + 整理(R/O/C 页)⏱️ 质量闭环

13. **`lib/similarity.ts`**:移植 SequenceMatcher + medley 检测(`04` §功能 7)。
14. **`lib/checkMatches.ts`**:移植 8 级分类(`04` §功能 7,核心算法,加单测)。
15. **`metadata.rs`**:Rust 用 `lofty` 读 opus/m4a 的 title/artist/album/cover/synopsis,经 Command 暴露。
16. **R 页**:运行校验 → 分类卡片 → 明细表(筛/排)→ 行内操作(打开/重下)。
17. **O 页**:`fs_ops.rs` 暴露 move/copy/rename/readdir;前端按分类挪 + 按元数据改名(dry-run + apply)。
18. **C 页**:用 `metadata.rs` 读 synopsis,匹配 `Provided to YouTube by` 签名。

✅ **阶段 3 验收:下载 → 校验分类 → 整理改名,完整质量闭环。** 对应原型 R/O/C 页。

### 阶段 4:工具 + 设置 + 帮助(T/S/H 页)⏱️ 补全

19. **T 页**:opus→mp3(spawn ffmpeg + `lofty` 拷标签)、shuffle_rename。
20. **`cookies.rs`**:Rust 读浏览器 SQLite cookie 库(`browsercookie` crate)+ 写 Netscape 格式。
21. **S 页**:Cookies 三来源 + 测试、代理 + 测试、过滤词编辑器、路径、`config.ts` 读写 `config.user.json`、环境自检(调用 `sidecar.rs` 探 yt-dlp/ffmpeg/deno)。
22. **H 页**:把 `prototype/` 的帮助中心搬过来(快速上手/分类体系/FAQ/排错向导/诊断包导出)。
23. **`plugins/ytmusic_search/`**:~30 行 Python,stdin 收 query → ytmusicapi.search → stdout 吐 JSON。前端检测 Python 可用性后提供"启用高精度搜索"开关。

✅ **阶段 4 验收:原型 8 个页面全部功能化。** 此时功能对齐 MVP 验收标准(`01` §6)。

### 阶段 5:打包分发 ⏱️ 三端产物

24. **`tauri.conf.json`** 配 `bundle.targets` = `['nsis','dmg','appimage','deb']`。
25. **`sidecar.rs`**:优先用内置 `binaries/yt-dlp`,fallback 到 PATH。用 `tauri sidcar` 机制按平台打包。
26. 代码签名:mac 需 Developer ID(可选,不签则用户首次右键打开);Win 可选 Authenticode。
27. CI:GitHub Actions 三平台 matrix 构建,产出 release 资产。
28. ffmpeg 是否内置:**默认不内置**(体积+许可证),首启环境自检引导下载;提供"内置 ffmpeg"的增强构建变体。

✅ **阶段 5 验收:三端安装包可下载,普通用户免装 Python/Rust/Node。**

---

## 3. 里程碑与时间预估

> 时间是粗估(单人全职),仅供排序。实际按里程碑驱动,不追进度。

| 里程碑 | 对应阶段 | 产出 |
|--------|---------|------|
| **M1 可下 1 首** | 阶段 1 | 单 URL 下载 + 进度 |
| **M2 下载主线** | 阶段 2 | 歌单批量 + 质量确认 + 断点续传 |
| **M3 质量闭环** | 阶段 3 | 校验 + 整理 + 改名 |
| **M4 功能对齐** | 阶段 4 | 8 页全功能 + 帮助 + 可选插件 |
| **M5 可分发** | 阶段 5 | 三端安装包 |

每个里程碑达到后提交一次,保持 `feat/ui-integration` 分支可运行。

---

## 4. 移植对照表(Python → TS,开发时逐条勾)

| Python 文件 | 行数 | TS 目标 | 难度 | 阶段 |
|-------------|------|---------|------|------|
| `parse_list.py` | 108 | `lib/parseList.ts` | ⭐ | 2 |
| `downloader.py:pick_best` | 73 | `lib/pickBest.ts` | ⭐⭐ | 2 |
| `downloader.py:search_song` | 15 | `lib/search.ts`(ytsearch) | ⭐⭐ | 2 |
| `check_matches.py`(分类) | 213 | `lib/checkMatches.ts` + `similarity.ts` | ⭐⭐ | 3 |
| `organize_by_check.py` | 140 | O 页 + `fs_ops.rs` | ⭐ | 3 |
| `rename_by_metadata.py` | 224 | O 页 + `metadata.rs` | ⭐ | 3 |
| `list_non_catalog.py` | 200 | C 页 + `metadata.rs` | ⭐ | 3 |
| `opus2mp3.py` | 233 | T 页 + ffmpeg spawn | ⭐ | 4 |
| `download_from_urls.py` | 249 | U 页 | ⭐ | 2 |
| `export_cookies.py` | 124 | S 页 + `cookies.rs` | ⭐⭐⭐ | 4 |
| `shuffle_rename.py` | 249 | T 页 | ⭐ | 4 |
| `find_duplicates.py` | ~200 | T 页 | ⭐ | 4 |
| —(新增)— | — | `lib/confidence.ts`(D-10/11) | ⭐⭐ | 2 |
| **总计** | ~2200 | — | — | — |

---

## 5. 关键技术决策记录(开发时遵守)

1. **yt-dlp/ffmpeg 一律走子进程,不内嵌为库。** 崩溃隔离 + 不绑语言。
2. **进度只走 Tauri Event,不开 HTTP 端口。** 对比早期 FastAPI 方案,无端口占用、零网络栈。
3. **`config.py` 只读,UI 永远写 `config.user.json`。** 加载优先级:user.json > config.py。
4. **置信度算法集中在 `lib/confidence.ts`**,与 `pickBest` 解耦——pickBest 选最优,confidence 评判"这最优够不够可信"。两者都基于同一打分,但 confidence 额外考虑黑名单/降权词命中情况输出原因。
5. **可选 Python 插件用 stdin/stdout JSON 通信**,不走网络。前端 `invoke('run_plugin', {script, input})` → Rust spawn python → 读 stdout。
6. **长任务统一进 `taskStore`**(Zustand),每任务有 id/state/progress/cancel。WS 替换为 Tauri Event。
7. **Rust 层保持"薄"**:只做"调子进程 + fs + lofty",不做业务逻辑。业务逻辑全在 TS,便于迭代和单测。

---

## 6. 风险与对策(开发期)

| 风险 | 对策 |
|------|------|
| yt-dlp 子进程在 Windows 下编码/路径问题 | 用 `tauri::api::process::Command` + 显式 UTF-8;路径用 `dunce`(Windows 短路径) |
| `lofty` 对某些 opus 的 synopsis 字段支持不全 | 兜底:lofty 读不到时,spawn `ffprobe` 拿 description |
| opencc-js 词典体积(~2MB) | 首次加载缓存到 IndexedDB;或放 Rust 侧 `opencc-rust` |
| 浏览器 cookies 在新版 Chrome(加密变更)失效 | 优先推 cookies.txt 手动方式;浏览器提取作 fallback 并明确提示 |
| Tauri 2.x 生态较新踩坑 | 锁定稳定小版本;遇坑优先查 tauri-discussions |

---

## 7. 当前位置 & 下一步

**已完成(本分支):**
- ✅ 需求文档 `01`(含 D-9~12、H-1~8)
- ✅ 技术选型 `02`(最终 B+)
- ✅ 实现策略 `03`/`04`(逐功能代码级对照)
- ✅ HTML 原型 `prototype/`(8 页 + 帮助中心 + 质量确认)
- ✅ 本开发计划 `05`

**下一步(待用户确认即开始):**
- 阶段 0:装 Rust + yt-dlp + deno(需用户在本机执行,或授权我执行)
- 阶段 1:`npm create tauri-app` 初始化 `ui/` + 跑通单首下载主干

> 阶段 0 的工具链安装会改动本机环境(装 Rust、yt-dlp、deno)。
> 我会先确认是否授权执行这些安装,再动手。
