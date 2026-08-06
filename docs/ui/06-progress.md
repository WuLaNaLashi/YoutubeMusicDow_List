# YT_Music UI 开发进度

> 活文档,随每次提交更新。分支:`feat/ui-integration`
> 规划依据:`05-development-plan.md`(5 阶段 5 里程碑)

## 里程碑状态

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **M1 可下 1 首** | ✅ 完成 | Tauri+React 骨架,单首下载 + 实时进度(`3e9dac6`) |
| **M2 下载主线** | ✅ 完成 | 歌单批量 + 质量确认 + 断点续传 + 并发 + 持久化 |
| **M3 质量闭环** | 🚧 进行中 | 校验(R)+ 整理改名(O)+ 来源识别(C) |
| **M4 功能对齐** | ⏳ 待开始 | T/S/H 页 + 可选 ytmusicapi 插件 |
| **M5 可分发** | ⏳ 待开始 | 三端打包 |

## 功能完成度

### 阶段 1:工程骨架(M1)✅
- [x] Tauri 2 + React 19 + TS + Tailwind v4 工程到 `ui/`
- [x] Rust 薄壳 `process.rs`:`run_command`/`cancel_task`/`probe_binary`,spawn yt-dlp/ffmpeg 流式推输出
- [x] 核心逻辑 TS 移植:`parseList`/`opencc`/`similarity`/`checkMatches`/`pickBest`
- [x] `confidence.ts`(D-10/D-11):三档置信度 + 存疑原因
- [x] `search.ts`:yt-dlp ytsearch 解析
- [x] `downloadOrchestrator`:搜索→打分→置信度→策略→下载
- [x] `config.ts`:config.user.json 读写
- [x] D 页 UI:歌单编辑/导入、下载目录、质量策略、进度、明细表、候选确认弹层、日志
- [x] App.tsx:8 页框架(其余占位)

### 阶段 2:下载主线补全(M2)✅
- [x] **系统代理自动探测**(S-N2):macOS scutil / Windows 注册表 / Linux gsettings;优先级 config.proxy > env > 系统设置(`a122923`)
- [x] **选路径修复**:capabilities 授权 dialog/fs/shell(`92d7875`)
- [x] **显式「开始下载」门控**:填完歌单后才显示全量/测试按钮
- [x] **done 行显示文件 + 打开目录**(revealItemInDir)
- [x] **候选确认弹层「试听」**:openUrl 跳 YT Music
- [x] **并发下载**:worker 池,confirm 模式降为串行(避免多弹层)
- [x] **success/failed.json 持久化**:每首完成落盘,断点续传
- [x] **断点续传**:success.json 已成功的自动跳过

### 阶段 3:质量闭环(M3)🚧
- [x] Rust `metadata.rs`(lofty):读 opus/m4a/mp3 的 title/artist/album/synopsis/cover/duration;来源分类(catalog/non_catalog);扫描目录
- [x] Rust `fs_ops.rs`:list_dir/move/copy/rename/delete/join_path
- [x] `checkService.ts`:读 success.json → classify 8 级 → 可选读磁盘元数据
- [ ] **R 页 UI**:运行校验 + 8 类分类卡片 + 明细表 + 行内操作(打开/重下)
- [ ] **O 页 UI**:按分类挪文件 + 按元数据改名(dry-run + apply)
- [ ] **C 页 UI**:来源识别扫描 + non_catalog 明细

### 阶段 4:补全(M4)⏳
- [ ] T 页:opus→mp3 转码 + shuffle_rename
- [ ] S 页:Cookies 三来源 + 测试、代理、过滤词、路径、环境自检
- [ ] H 页:帮助中心(原型已有,搬过来)
- [ ] 可选 ytmusicapi Python 插件

### 阶段 5:分发(M5)⏳
- [ ] tauri bundler 三端打包
- [ ] yt-dlp sidecar 内置

## 已知问题(待修)

- **UI 不跟手**:opencc-js 词典 ~2MB 在主线程同步加载,阻塞渲染。计划:阶段 4 改 Web Worker 懒加载。
- **代理未在设置页可视**:已实现探测,但 S 页未做,当前只能从日志看"代理: xxx"。
- **失败重试 UI**:failed.json 已记录,但 D 页未提供"重试失败项"入口。

## 验证记录

- Rust:`cargo check` 通过(含 lofty 0.21 / tokio)
- TS:`pnpm exec tsc --noEmit` 通过
- 构建:`pnpm build` 通过
- 运行:`tauri dev` 启动,下载功能实测可用
- 单测:`cargo test` proxy 模块 2 个用例通过(含真实 scutil 输出)
