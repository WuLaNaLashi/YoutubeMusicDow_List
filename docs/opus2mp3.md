# opus2mp3.py — opus 转 mp3（保留封面与标签）

把某个目录下的 `.opus` 文件**批量转码**为 `.mp3`，并把 opus 里嵌入的封面、标题、艺人、专辑等元数据一并迁移过去。

> 适用场景：下载链路默认产出 `.opus`（见 [main.md](main.md)），但有些播放设备/软件（车载、老人机、SD 卡音箱、老旧播放器）只认 mp3，需要转一道。

---

## 一、命令行参数

```
usage: opus2mp3.py [-h] --dir DIR [--recursive] [--bitrate BITRATE]
                   [--delete-original] [--apply]

必填:
  --dir DIR            要转码的目录（包含 .opus 文件）

可选:
  --recursive          连子目录一起扫（默认只扫 --dir 第一层）
  --bitrate BITRATE    libmp3lame CBR 码率，默认 320k（mp3 码率上限）
  --delete-original    转码成功后删除源 .opus（默认保留）
  --apply              实际执行转码；不带这个参数只做 dry-run 预览
  -h, --help           查看帮助
```

### 关键参数说明

| 参数 | 作用 |
|------|------|
| `--dir` | **必填**。指向存 opus 的目录，输出会写到 `<该目录>/mp3/` 子文件夹。 |
| `--recursive` | 默认只扫第一层。带上后会递归所有子目录；输出统一**扁平化**到 `<dir>/mp3/`，**不保留**原目录层级。 |
| `--bitrate` | 默认 `320k`，即 mp3 的码率上限。也可给 `192k`、`256k` 等。 |
| `--delete-original` | 转码成功后**删除源 opus**，节省空间。**失败不会删**。 |
| `--apply` | **安全开关**。默认 dry-run，只列出"会转哪些文件"，不真正写盘。确认无误再加 `--apply`。 |

---

## 二、典型用法

### 1. 预览（dry-run，默认行为）

```bash
python src/opus2mp3.py --dir downloads
```

输出示例：

```
Dir: downloads  recursive=False  bitrate=320k
Found 23 .opus file(s) -> mp3/

  田馥甄 - 还是要幸福.opus  ->  mp3/田馥甄 - 还是要幸福.mp3
  徐佳莹 - 一样的月光.opus  ->  mp3/徐佳莹 - 一样的月光.mp3
  ...

(dry-run — pass --apply to transcode)
```

### 2. 正式转码（保留源 opus）

```bash
python src/opus2mp3.py --dir downloads --apply
```

输出会逐首显示进度和迁移了哪些标签：

```
[1/23] 田馥甄 - 还是要幸福.opus
      -> mp3/田馥甄 - 还是要幸福.mp3  [title, artist, album, date, cover×1]
```

### 3. 递归 + 转码后删源（彻底替换）

```bash
python src/opus2mp3.py --dir downloads --recursive --apply --delete-original
```

> ⚠️ `--delete-original` 不可逆，建议先**不加**它跑一次确认输出 OK，第二次再加。

### 4. 自定义码率（省空间，听感差异不大）

```bash
python src/opus2mp3.py --dir downloads --apply --bitrate 192k
```

---

## 三、转码做了什么？

### 音频流

调用系统 `ffmpeg`：

```
ffmpeg -y -hide_banner -loglevel error \
  -i <input.opus> \
  -vn                       # 忽略视频流（封面在标签里，不在视频流）
  -c:a libmp3lame \
  -b:a 320k                 # CBR 320 kbps（默认）
  <output.mp3>
```

- **不重采样**：保留源的采样率（YouTube opus 通常是 48000 Hz）。
- **opus → mp3 是有损 → 有损**，所以默认用 320k CBR（libmp3lame 的上限）把二次损失压到最小。

### 元数据迁移

opus 用 Vorbis Comments 存标签，mp3 用 ID3。脚本通过 `mutagen` 把以下字段从 opus 拷进 mp3 的 **ID3v2.4 + UTF-8**：

| opus Vorbis key | mp3 ID3 frame | 说明 |
|-----------------|---------------|------|
| `title`         | `TIT2`        | 标题 |
| `artist`        | `TPE1`        | 艺人 |
| `album`         | `TALB`        | 专辑 |
| `genre`         | `TCON`        | 流派 |
| `date`          | `TDRC`        | 录制时间（取前 4 位年份）|
| `metadata_block_picture` | `APIC` | 封面（base64 FLAC picture block → 按字节原样写入）|

> 主动**丢弃**的字段：`description`、`purl`、`synopsis`（YouTube 自动生成的英文元信息，对本地播放无用）。

---

## 四、输出布局

```
downloads/                          ← 你传入的 --dir
├── 田馥甄 - 还要是幸福.opus          ← 源（除非加 --delete-original）
├── 徐佳莹 - 一样的月光.opus
└── mp3/                            ← 自动创建
    ├── 田馥甄 - 还要是幸福.mp3       ← 转码产物（扁平化）
    └── 徐佳莹 - 一样的月光.mp3
```

### 同名冲突处理

如果 `--recursive` 扫到多个同名 opus（不同子目录下），第二个会在文件名后加 ` (2)`、第三个加 ` (3)`，避免覆盖：

```
mp3/同名歌.mp3
mp3/同名歌 (2).mp3
```

---

## 五、环境依赖

**无新增 Python 依赖**：复用 `mutagen`（已在 `requirements.txt` 里）。

**系统依赖**：

```bash
# Ubuntu / Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

验证 ffmpeg 可用：

```bash
ffmpeg -version | head -1
ffmpeg -encoders 2>/dev/null | grep libmp3lame   # 应有输出
```

---

## 六、常见问题

### Q: 转出来的 mp3 没有封面？

检查源 opus 是否有封面。用 ffprobe 看一眼：

```bash
ffprobe -hide_banner "/path/to/源.opus" 2>&1 | grep -i -E "metadata|picture"
```

如果 opus 本身就没有 `metadata_block_picture` 字段（早期下载没嵌封面），那 mp3 自然也没有。

### Q: 报错 `FAIL CalledProcessError ... ffmpeg rc=1`

通常是 ffmpeg 缺失或 opus 文件损坏。先单独跑一条命令看具体错误：

```bash
ffmpeg -i "/path/to/源.opus" -vn -c:a libmp3lame -b:a 320k /tmp/test.mp3
```

### Q: 文件名里有特殊字符转码失败？

脚本只对输出目录名做 sanitize，文件名直接用 opus 的 stem。如果原文件名含 `/`、`:` 等非法字符，先重命名再转。

### Q: 转完后 mp3 文件名和内容对不上？

这种情况源文件本身的命名就有问题（比如下载时匹配错了）。**先**用 [rename_by_metadata.md](rename_by_metadata.md) 按内嵌元数据把源 opus 改对名，**再**跑转码。

---

## 七、相关文档

- [main.md](main.md) — 下载入口（产出 .opus 文件的源头）
- [rename_by_metadata.md](rename_by_metadata.md) — 按内嵌标签改名（转码前先理顺文件名）
- [项目总 README](../README.md)
