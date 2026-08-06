# YT_Music UI 技术选型

> 版本:v2.0(最终方案已确认)  日期:2026-08-06  分支:`feat/ui-integration`
> 依赖:`01-requirements.md`、`03-implementation-strategy.md`、`04-implementation-details.md`
> 状态:✅ 已确认(见 §7)

本文档做技术选型。结论先行。

> ⚠️ 本文档 §1~§6 保留了选型**过程**的对比分析(供回顾决策依据);
> 但"结论/选什么"以 **§0** 和 **§7** 为准——早期 v1.0 草案曾倾向 Electron + Python 后端,
> 经 `03`/`04` 两份文档重新评估后,最终定为 **Tauri + TS 全栈 + 可选 ytmusicapi 插件(B+)**。

---

## 0. 一句话结论(最终方案 · B+)

**Tauri 桌面壳 + React/TypeScript 前端 + Rust 薄壳后端。**

- **主体**:TS 写全部应用逻辑(歌单解析、候选打分、8 级匹配分类、文件整理/改名、转码调度、cookies 解析),Rust 层只做 ~200 行模板代码(spawn yt-dlp/ffmpeg 子进程、文件操作、`lofty` 读元数据、Tauri 事件推进度)。
- **下载/转码内核**:yt-dlp、ffmpeg 作为**原生二进制子进程**调用(不依赖 Python 解释器),崩溃隔离不影响主进程。
- **搜索精度增强(可选)**:ytmusicapi 包成 ~30 行 Python 小脚本作为**可选插件**,用户装了 Python 才启用"高精度搜索",默认走 yt-dlp ytsearch。
- **UI**:shadcn/ui + Tailwind。
- **配置持久化**:`config.user.json`(覆盖 `config.py` 默认值,不污染源码)。

这样:默认分发纯净(15-25MB,无 Python 运行时),在意搜索精度的用户可 opt-in 启用插件,两全。详见 `04-implementation-details.md` 的逐功能实现对照。

---

## 1. 选型约束(来自需求)

| 约束 | 来源 | 权重 |
|------|------|------|
| Win/macOS/Linux 三端原生 | §4 非功能 | **硬性** |
| 复用现有工具的**功能**(非脚本本身) | §5 边界 | **硬性** |
| 普通用户免装 Python | §4 分发(目标) | 高 |
| 实时进度 < 1s 延迟 | §4 实时性 | 高 |
| cookies/代理等配置可视化 | §3.7 | 高(用户明确强调) |
| 分发干净、体积小 | §4 分发 | 高 |

核心矛盾:**前端要跨平台易分发** vs **后端是 Python 且不能丢**。
→ 经评估(`03`/`04`),矛盾被化解:只有 ytmusicapi 真离不开 Python,做成可选插件即可。
这决定了必须是"前端壳 + Python 后端"的双层架构,而不是单一语言全栈。

---

## 2. 分发形态对比(顶层决策)

| 方案 | 跨平台 | 复用 Python | 免装 Python | 体积 | 开发复杂度 |
|------|--------|-------------|-------------|------|-----------|
| **A. 纯 Python GUI**(Tkinter/PyQt) | ✅ | ✅ 直接 | ⚠️ 需 PyInstaller 打包 | 中(50-80MB) | 低 |
| **B. Web 壳 + Python 后端**(Electron/Tauri + FastAPI) | ✅ | ✅ 通过 HTTP/WS | ⚠️ 需打包 Python 运行时 | 大(100-150MB) | 中 |
| **C. 纯 Web 应用**(浏览器访问本地服务) | ✅ | ✅ | ❌ 用户要起服务 | 小 | 低 |
| **D. 纯前端 + WASM 重写** | ✅ | ❌ 全重写 | ✅ | 小 | **极高** |

**分析:**
- **D 直接淘汰**——yt-dlp/ytmusicapi 是纯 Python,重写成 JS/WASM 不现实,违反"不重写内核"。
- **C 体验最差**——用户要自己 `python main.py --serve` 再开浏览器,违背"普通用户能用"目标。
- **A vs B 是真正的分歧点。**

### A(Python GUI) vs B(Web 壳)深入对比

| 维度 | A: PyWebView/PyQt | B: Electron/Tauri + FastAPI |
|------|-------------------|-----------------------------|
| UI 美观度 | 一般(Tkinter差/PyQt中) | **好**(任意 CSS/组件库) |
| 现代组件库 | 弱(Qt Widgets) | **极丰富**(Ant Design/MUI/shadcn) |
| 实时进度实现 | QThread+Signal / 回调 | WebSocket,**前端天然适合** |
| 复杂表格(歌单/校验明细) | 需手搓或用 Qt Model | **现成**(ag-Grid/TanStack Table) |
| 跨平台一致性 | 中(各平台原生控件差异) | **高**(Chromium 渲染一致) |
| 与现有 Python 代码集成 | **最直接**(同进程 import) | 需起 FastAPI 进程,通过 HTTP/WS |
| 打包 | PyInstaller 一键 | 需同时打包前端 + Python 运行时 |
| 团队技能 | 要会 Qt | Web 栈更通用 |
| 维护与生态 | 收缩中 | **主流**(VSCode/Discord/Slack 都是) |

**为什么推荐 B 而非 A:**
1. 需求里有大量"表格 + 实时刷新 + 分类卡片 + 表单"(D-5/R-2/R-3/S-D4),Web 前端组件库直接覆盖,Qt 要手搓且观感旧。
2. cookies 管理(S-C1~C5)、设置表单这类交互,Web 表单生态远优于桌面 GUI。
3. 需求 §4 明确"实时进度 < 1s",WebSocket + 前端状态管理是这套场景的标准解。
4. 前端栈(React/TS)通用性高于 Qt,后续招人/维护成本低。
5. 唯一代价是"打包体积大 + 要带 Python 运行时",但这是可接受的工程代价。

> ⚠️ **这是第一个需要你拍板的决策点。** 如果你强烈倾向"单进程纯 Python、装包小、不在意 UI 观感",
> 选 A(PyQt6)也完全可行。详见文末"待用户确认"。

---

## 3. 推荐架构(方案 B 细化)

```
┌─────────────────────────────────────────────────────────┐
│  Electron / Tauri 桌面壳                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │  前端:React + TypeScript + Vite                   │  │
│  │  UI:Tailwind + shadcn/ui(或 Ant Design)         │  │
│  │  状态:Zustand  路由:React Router                │  │
│  │  表格:TanStack Table  图标:lucide               │  │
│  └────────────────────┬──────────────────────────────┘  │
│                       │ HTTP(REST) + WebSocket          │
│                       ▼                                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Python 后端:FastAPI                              │  │
│  │  - /api/config        GET/PUT 配置                │  │
│  │  - /api/songs         GET/PUT 歌单                │  │
│  │  - /api/download      POST 启动(返回 task_id)   │  │
│  │  - /api/tasks/{id}    GET 状态 / DELETE 取消     │  │
│  │  - /api/check         POST 校验                   │  │
│  │  - /api/organize      POST                        │  │
│  │  - /api/rename        POST                        │  │
│  │  - /api/transcode     POST                        │  │
│  │  - /api/cookies       GET/POST(导出/上传/测试)  │  │
│  │  - /ws/tasks          WS 进度推送                 │  │
│  │  内部直接 import:                                  │  │
│  │    downloader.process_song                        │  │
│  │    check_matches.build_rows / classify            │  │
│  │    organize_by_check / rename_by_metadata         │  │
│  │    opus2mp3 / shuffle_rename / export_cookies     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**关键点:** 后端不是"调 CLI 子进程",而是 **import 现有模块的函数**。
现有脚本的核心逻辑(`process_song`、`build_rows`、`classify` 等)都是可复用的纯函数,
直接在 FastAPI 里调用即可,零重写。CLI 入口(`main.py` 等)保持不变,继续可用。

---

## 4. 具体技术清单

### 4.1 桌面壳:Electron vs Tauri

| | Electron | Tauri |
|---|---|---|
| 内核 | Chromium + Node | 系统 WebView + Rust |
| 体积 | ~100MB | ~10MB |
| 成熟度 | 极高(VSCode/Discord) | 较新但稳定 |
| 与 Python 后端共存 | Node 主进程拉起 Python 子进程 | Rust 主进程拉起 Python 子进程 |
| 学习曲线 | 低(JS 全栈) | 中(要懂 Rust 配置) |

**最终选 Tauri**:体积优势显著(壳 ~10MB,整体打包含 Python 后端约 40-60MB,Electron 约 100-150MB),前端栈(React/TS/shadcn)与 Electron 方案完全相同,迁移成本为零。代价是 Tauri 生态较新、需少量 Rust 配置,但首版主进程逻辑简单(拉起 Python 后端 + 管理 WebView),Rust 部分基本是模板代码。

### 4.2 前端框架

| 项 | 选型 | 理由 |
|----|------|------|
| 框架 | **React 18** | 生态最大,组件库选择多 |
| 语言 | **TypeScript** | 中大型项目必备,减少运行时错误 |
| 构建 | **Vite** | 快,HMR 好 |
| UI 库 | **shadcn/ui + Tailwind** | 美观、可定制、不锁框架;备选 Ant Design(组件更全,中文友好) |
| 路由 | React Router v6 | 标配 |
| 状态 | **Zustand** | 轻量,够用;Redux 太重 |
| 表格 | **TanStack Table v8** | 处理歌单/校验明细这类大表 |
| 图标 | lucide-react | 配 shadcn |
| 请求 | ky / native fetch | 轻量 |
| WS | native WebSocket | 不需要额外库 |

### 4.3 后端

| 项 | 选型 | 理由 |
|----|------|------|
| 框架 | **FastAPI** | 自带 OpenAPI、原生支持 async + WebSocket、与现有 Python 同语言 |
| WS 推送 | FastAPI WebSocket | 下载/转码进度推送 |
| 任务抽象 | 自建 `TaskManager`(asyncio + ThreadPoolExecutor) | 现有 `process_song` 是同步阻塞函数,用线程池跑,结果通过 queue 推 WS |
| 配置持久化 | **`config.user.json`**(新增) | UI 写它,后端读它并覆盖 `config.py` 默认值。**不直接改 `config.py`**,避免污染源码 |
| 日志 | 复用 `logging`,加一个 WebSocket handler | 把日志实时推前端底部抽屉 |

### 4.4 配置持久化策略(回答需求 Q3)

**新增 `config.user.json`,UI 管理,不动 `config.py`。**

加载优先级:`config.user.json`(UI 写) > `config.py`(源码默认)。
`config.py` 保持纯默认值,继续可手改、可 git 跟踪。
用户在 UI 改的所有东西落 `config.user.json`(gitignore),CLI 启动时也读它。

这样:CLI 用户和 UI 用户互不干扰,设置可迁移,源码干净。

### 4.5 打包/分发

| 目标平台 | 工具 | 产物 |
|----------|------|------|
| Windows | electron-builder + PyInstaller | `.exe`(NSIS 安装包) |
| macOS | 同上 | `.dmg`(含 app bundle) |
| Linux | 同上 | `.AppImage` / `.deb` |

PyInstaller 把 Python 后端 + 所有依赖(yt-dlp/mutagen/ytmusicapi/opencc)打包成单可执行;
electron-builder 把前端 + Electron 壳 + Python 可执行 打成安装包。
**ffmpeg 和 deno 仍需用户自备**(首版在"环境自检"里提示下载链接,不内置,避免体积爆炸+许可证问题)。

---

## 5. 数据流示例:下载一首歌

```
用户点"全量下载"
  → 前端 POST /api/download {mode: "all", resume: true}
  → 后端 TaskManager 创建 task_id,起 ThreadPoolExecutor
     → 每个 worker 调 downloader.process_song(song)
        → 每完成一首:写 success.json + 推 WS {task_id, type:"progress", ...}
  → 前端 WS /ws/tasks 收到 → 更新进度条 + 表格行状态
  → 全部完成:推 {type:"done", summary:{ok, fail}}
```

进度颗粒度:**每首歌一个事件**(开始/搜索命中/下载中/完成/失败),不是百分比 polling。
这天然满足"<1s 延迟"。

---

## 6. 工程结构(规划,开发阶段落地)

```
YoutubeMusicDow_List/
├── src/                       # 现有 Python 脚本(保持不变)
├── ui/
│   ├── backend/               # 新增:FastAPI 后端
│   │   ├── main.py            # FastAPI app
│   │   ├── task_manager.py    # 任务/进度抽象
│   │   ├── routes/
│   │   │   ├── config.py
│   │   │   ├── songs.py
│   │   │   ├── download.py
│   │   │   ├── check.py
│   │   │   ├── organize.py
│   │   │   ├── cookies.py
│   │   │   └── ...
│   │   └── ws.py              # WebSocket 推送
│   └── frontend/              # 新增:React 前端
│       ├── package.json
│       ├── vite.config.ts
│       ├── src/
│       │   ├── pages/         # Download/Review/Organize/Tools/Settings
│       │   ├── components/
│       │   ├── api/           # HTTP + WS 客户端
│       │   └── stores/        # Zustand
│       └── electron/          # Electron 主进程(拉起 backend)
├── prototype/                 # HTML 原型(本次先做)
├── docs/ui/                   # 本文档系列
└── config.user.json           # UI 写的配置(gitignore)
```

---

## 7. 已确认的决策点(最终)

| # | 问题 | 决策 |
|---|------|------|
| **Q1** | 分发形态 | ✅ **Tauri + React + TS**(Web 壳) |
| **Q2** | UI 组件库 | ✅ **shadcn/ui + Tailwind CSS** |
| **Q3** | 配置持久化 | ✅ **新增 `config.user.json`**(UI 管理,覆盖 `config.py` 默认) |
| **Q4** | 桌面壳 | ✅ **Tauri**(非 Electron,体积更小) |
| **Q5** | 实现路径 | ✅ **B+:TS 全栈 + yt-dlp/ffmpeg 二进制 + 可选 ytmusicapi 插件** |

> Q5 是在 `03-implementation-strategy.md` / `04-implementation-details.md` 中,
> 重新评估"是否绑死 Python"后做出的最终决策。早期 v1.0 的 Electron+FastAPI 方案作废。

---

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| Electron 打包带 Python 运行时,体积大(可能 150MB+) | 可接受;Tauri 备选 |
| 同进程跑 yt-dlp 偶发卡死 | 用 ThreadPoolExecutor 隔离 + 任务超时取消 |
| FastAPI 与现有脚本的全局 `config` 模块耦合 | 后端启动时加载 `config.user.json` 覆盖,不破坏 CLI |
| WebSocket 在某些网络(代理)下断连 | 前端实现重连 + 任务状态 REST 兜底查询 |
| ffmpeg/deno 不内置,用户首启失败 | 环境自检 + 引导下载链接 |

---

## 9. 下一步

1. ✅ 决策已确认:Tauri + React + FastAPI + shadcn/ui + config.user.json。
2. **做 HTML 原型**(`prototype/`),用浏览器即可预览,对齐 UI 布局与信息架构。
3. 原型确认后,按 §6 工程结构落地后端 + 前端骨架。
