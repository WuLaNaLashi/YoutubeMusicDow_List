# YT_Music UI 开发进度

> 活文档,随每次提交更新。分支:`feat/ui-integration`(已推 origin)
> 规划依据:`05-development-plan.md`(5 阶段 5 里程碑)

## 里程碑状态

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **M1 可下 1 首** | ✅ 完成 | Tauri+React 骨架 + 单首下载(`3e9dac6`) |
| **M2 下载主线** | ✅ 完成 | 批量+并发+质量确认+断点续传+持久化 |
| **M3 质量闭环** | ✅ 完成 | 校验(R)+ 整理改名(O)+ 来源识别(C) |
| **M4 功能对齐** | 🚧 进行中 | U 页✅ / S 页基础✅ / T 页⏳ / H 页⏳ / 插件⏳ |
| **M5 可分发** | ⏳ 待开始 | 三端打包 |

## 提交历史(本分支)

```
a9c2ef0 feat(ui): S 页基础 - 环境自检/网络代理/路径
599660f feat(ui): U 页 - URL 直下(跳过搜索直接下载)
1106c07 perf(ui): 修界面不跟手 - opencc 懒加载 + 歌单防抖 + 表格限 200 行
0a08ba3 feat(ui): C 页 - 来源识别(M3 质量闭环完成)
43535ea feat(ui): O 页 - 文件整理(按分类挪+按元数据改名+目录浏览)
8a38cf8 feat(ui): R 页 - 匹配校验(8类分类卡片+明细+重下入口)
98326a5 feat(ui): 阶段2/3 进展 - 并发下载+持久化+元数据后端+校验服务
92d7875 fix(ui): 修复选路径无反应 + 增强下载交互
a122923 feat(ui): 系统代理自动探测(S-N2)
3e9dac6 feat(ui): 阶段1 - Tauri+React 工程骨架与下载主线打通 (M1)
49fe967 docs(ui): 需求/选型/实现策略/开发计划 + HTML 原型
```

## 页面完成度

| 页面 | 状态 | 说明 |
|------|------|------|
| **D 下载** | ✅ | 歌单编辑/导入、下载目录、质量策略、并发、断点续传、置信度、候选确认、日志 |
| **R 匹配校验** | ✅ | 读 success.json → 8 级分类 → 卡片+明细+重下 |
| **O 文件整理** | ✅ | 按分类挪文件、按元数据改名、目录浏览(均 dry-run+apply) |
| **C 来源识别** | ✅ | scanAudioDir → catalog/non_catalog 分类统计+明细 |
| **U URL 直下** | ✅ | URL 列表解析+下载,跳过搜索 |
| **S 设置(基础)** | ✅ | 环境自检、网络代理(探测+手填+测试)、路径展示 |
| **T 转码&改名** | ⏳ | opus→mp3、shuffle_rename(未做) |
| **H 帮助中心** | ⏳ | 原型已有完整内容,待搬到应用 |

## 后端能力(Rust)

| 模块 | 命令 | 说明 |
|------|------|------|
| `process.rs` | run_command / cancel_task / probe_binary | spawn yt-dlp/ffmpeg,流式推输出 |
| `proxy.rs` | detect_system_proxy_cmd / resolve_proxy_cmd | 系统代理探测(mac/win/linux) |
| `metadata.rs` | read_audio_meta / scan_audio_dir | lofty 读元数据+来源分类 |
| `fs_ops.rs` | list_dir / move / copy / rename / delete / join / exists | 文件操作 |

## 核心库(TS,自 Python 移植 + 新增)

| 文件 | 对应 Python | 状态 |
|------|-------------|------|
| parseList.ts | parse_list.py | ✅ |
| similarity.ts | check_matches(相似度/medley) | ✅ |
| checkMatches.ts | check_matches(8级分类) | ✅ |
| pickBest.ts | downloader.pick_best | ✅ |
| confidence.ts | (新增,D-10/D-11) | ✅ |
| search.ts | downloader.search_song(ytsearch) | ✅ |
| downloadOrchestrator.ts | main.py(并发+持久化) | ✅ |
| checkService.ts | check_matches.build_rows | ✅ |
| organizeService.ts | organize_by_check + rename_by_metadata | ✅ |
| urlDownload.ts | download_from_urls | ✅ |
| opencc.ts | opencc(繁简) | ✅ 懒加载 |
| config.ts | config.py(默认值+user.json) | ✅ |
| sanitize.ts | sanitize_filename | ✅ |

## 性能优化记录

- **bundle 1.4MB → 270KB**:opencc 词典懒加载,不进主 bundle
- **界面跟手**:歌单解析 300ms debounce;明细表限 200 行;opencc Converter 首次调用才创建
- **大歌单**:DOM 上限 + 筛选

## 已知问题 / 待办

- **T 页**:opus→mp3 转码(spawn ffmpeg)+ shuffle_rename 未做
- **H 页**:帮助中心(原型 `prototype/index.html` 有完整内容,待搬进应用)
- **可选 ytmusicapi 插件**:B+ 路径的高精度搜索,优先级中
- **失败重试 UI**:D 页缺"重试失败项"入口(failed.json 已记录)
- **Cookies 管理 UI**:S 页缺三来源管理(目前只能改 config.user.json)

## 验证记录(2026-08-06)

- Rust:`cargo check` ✓
- TS:`pnpm exec tsc --noEmit` ✓
- 构建:`pnpm build` ✓(270KB gzipped 84KB)
- 运行:多次 `tauri dev` 启动,下载/校验实测可用
- 单测:`cargo test` proxy 模块 2 用例 ✓
