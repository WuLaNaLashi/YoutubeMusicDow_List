# YT_Music UI

YT_Music 工具链的跨平台桌面应用。技术栈:**Tauri 2 + React 19 + TypeScript + Tailwind v4**,后端逻辑用 TS 移植自原 Python 脚本,内核 yt-dlp/ffmpeg 作为子进程调用(不依赖 Python 运行时)。

完整设计见 `../docs/ui/`(需求 / 选型 / 实现策略 / 开发计划 / 进度)。

## 开发

```bash
# 一次性:装 Rust、yt-dlp、deno、ffmpeg
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
brew install yt-dlp ffmpeg            # 或 pipx install yt-dlp
curl -fsSL https://deno.land/install.sh | sh

# 装依赖 + 启动 dev(热重载)
cd ui
pnpm install
pnpm tauri dev
```

## 打包

```bash
# 当前平台默认 target
pnpm tauri build

# 限定 bundle 类型(更快)
pnpm tauri build --bundles dmg        # mac
pnpm tauri build --bundles nsis       # win
pnpm tauri build --bundles appimage   # linux

# 限定架构(mac 双架构需分别构建)
pnpm tauri build --target aarch64-apple-darwin --bundles dmg
pnpm tauri build --target x86_64-apple-darwin --bundles dmg
```

产物在 `src-tauri/target/release/bundle/`。macOS arm64 实测 **dmg ~4.4MB**(对比 Electron 100MB+、Python 打包 60MB+)。

## CI 自动发布

打 tag 触发 `.github/workflows/release.yml`,三端构建(mac arm64/x64、linux、windows),产物上传到 GitHub Release。

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 工程结构

```
ui/
├── src/                       # React 前端
│   ├── pages/                 # 8 页:Download/Review/Organize/Catalog/Urls/Tools/Settings/Help
│   ├── lib/                   # 应用逻辑(TS,自 Python 移植)
│   │   ├── parseList / similarity / checkMatches / pickBest / confidence
│   │   ├── search / downloadOrchestrator / checkService / organizeService
│   │   ├── urlDownload / transcodeService / opencc / config / sanitize
│   ├── api/tauri.ts           # Tauri Command/Event 封装
│   ├── stores/                # Zustand
│   └── components/ui.tsx      # 基础组件
├── src-tauri/                 # Rust 主进程(薄壳)
│   └── src/
│       ├── process.rs         # spawn yt-dlp/ffmpeg + 流式进度
│       ├── proxy.rs           # 系统代理探测(mac/win/linux)
│       ├── metadata.rs        # lofty 读元数据 + 来源分类
│       ├── fs_ops.rs          # 文件操作
│       └── lib.rs             # 命令注册
└── tauri.conf.json
```

## 用户依赖(运行时)

应用不内置,需用户自备(帮助中心有安装指引):
- **yt-dlp** — 下载内核
- **ffmpeg** — 容器封装/转码/元数据
- **deno** — yt-dlp 解 YouTube JS 挑战(可选,node 兜底)
- **python3** — 可选,仅启用 B+ 高精度搜索插件时

设置页「环境自检」会探测这些是否在 PATH。
