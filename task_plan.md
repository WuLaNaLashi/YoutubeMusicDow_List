# 任务计划：opus → mp3 转码功能

## 目标
在现有音乐下载项目里新增一个独立脚本，把指定文件夹下的 `.opus` 批量转码为 `.mp3`，**保留内嵌封面**和**文本标签**，**音质尽量保留**。**已完成 ✅**

## 已确认的事实
- **Python 环境**：`/home/hanxiao/Python/HXPython-uv/bin/python`（uv 管理的 cpython 3.13.11，已装 mutagen 1.47.0）。
- **ffmpeg**：系统 `/usr/bin/ffmpeg` 6.1.1，含 `libmp3lame` 编码器。
- **下载产物形态**：`src/downloader.py` 用 yt-dlp `EmbedThumbnail` 后处理器 → opus 文件**内嵌封面**（`metadata_block_picture`）。
- **样本验证**：`BIGBANG - 谎言.opus` 封面 PNG 1280×720 type=3；转码后封面**逐字节一致**（882085 bytes）。
- **输出位置**（用户要求）：转码产物进 `--dir/mp3/` 子文件夹。

## 技术决策
| 决策点 | 选择 | 理由 |
|--------|------|------|
| 转码引擎 | ffmpeg `libmp3lame` | 唯一靠谱的 opus→mp3；项目已依赖 ffmpeg |
| 音质 | `-b:a 320k` CBR（mp3 上限） | 有损→有损取上限，设备兼容性最好 |
| 封面迁移 | mutagen 解 `metadata_block_picture` → ID3 `APIC` | ffmpeg 不自动带封面；mutagen 已在依赖里 |
| 标签迁移 | title/artist/album/genre/date → ID3 帧 | 跳过 description/purl/synopsis 等 youtube 垃圾字段 |
| ID3 版本 | **v2.4 + UTF-8** | mutagen 1.47 存 v2.3 会留下非标的 TDRC 帧；v2.4 内部一致，现代播放器全支持 |
| 输出位置 | `--dir/mp3/` 子文件夹（扁平+去重） | 用户指定 |
| 源文件 | 默认保留，`--delete-original` 可选删 | 安全默认 |
| 新增依赖 | 无 | 复用 mutagen + 系统 ffmpeg |

## 阶段（全部完成）
- [x] **阶段1** 分析需求 + 验证环境/封面
- [x] **阶段2** 确认 Python 环境（用户指定）
- [x] **阶段3** 编写 `src/opus2mp3.py`
- [x] **阶段4** 测试目录验证：`/home/hanxiao/Music/Youtube-20260611`（18 首，0 失败）
- [x] **阶段5** 文档（README 项目结构 + 详细用法节）

## 验证结果（输出 `mp3/BIGBANG - 谎言.mp3`）
- 时长 229.2s = 源 opus 229.18s ✓
- 320 kbps CBR / 48 kHz / 双声道 ✓
- ID3 v2.4.0，UTF-8；TDRC=2016、TIT2=거짓말 (Lies)、TPE1=BIGBANG ✓
- APIC 封面 PNG 1280×720 882085 bytes（= 源，逐字节一致）✓

## 遇到的错误
| 错误 | 原因 | 解决 |
|------|------|------|
| `OggOpusInfo` 无 `bitrate/sample_rate` | opus 固定 48k，info 只暴露 channels/length | 探测改用 channels/length |
| `OggOpus` 无 `.pictures` 属性 | ogg 封面存在 tags 里 | 直接读 `metadata_block_picture` + `mutagen.flac.Picture` |
| **TYER 存 v2.3 后变成 TDRC** | mutagen 1.47 即使 `v2_version=3` 也把年份存成 TDRC（v2.4 帧），v2.3 文件非标 | 改用 ID3v2.4 + UTF-8（实验确认后切换） |

## 用法
```bash
PY=/home/hanxiao/Python/HXPython-uv/bin/python
# 预览（dry-run）
$PY src/opus2mp3.py --dir /path/to/songs
# 正式转码（输出进 /path/to/songs/mp3/）
$PY src/opus2mp3.py --dir /path/to/songs --apply
# 递归 + 转码后删源
$PY src/opus2mp3.py --dir /path/to/songs --recursive --apply --delete-original
```
