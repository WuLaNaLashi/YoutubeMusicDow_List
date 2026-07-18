# rename_by_metadata.py — 按内嵌元数据改名

把音频文件名改成 `{内嵌真实艺人} - {内嵌真实标题}.{ext}`。

**用途**：[main.md](main.md) 下载的文件原本以「用户期望的艺人/标题」命名（来自歌单），但实际下载到的可能是另一首歌。本工具读文件**内嵌**的 `artist` / `title` 标签来改名，让**文件名和实际内容一致**。

---

## 一、命令行参数

```
usage: rename_by_metadata.py [-h] [--classes CLASSES | --dir DIR]
                             [--apply] [--recursive]

两种模式（互斥）:
  --classes CLASSES   通过 success.json + check_matches.classify 反查指定分类
                      默认: mismatch
                      可逗号分隔: --classes mismatch,warn_title_diff
  --dir DIR           指定目录，把里面所有音频按内嵌元数据改名（不依赖 success.json）

可选:
  --apply             实际执行（默认 dry-run）
  --recursive         （仅 --dir）递归子目录
  -h, --help          查看帮助
```

### 关键参数说明

| 参数 | 作用 |
|------|------|
| `--classes` | **智能模式**。只改 `success.json` 里、按 [check_matches.md](check_matches.md) 规则分类后落在指定类别的文件。默认 `mismatch`。可逗号分隔传多个类。 |
| `--dir` | **简单模式**。直接对某个目录下所有音频无脑改名，不依赖 `success.json`。和 `--classes` 互斥。 |
| `--apply` | **安全开关**。默认 dry-run，只打印计划。 |
| `--recursive` | 仅 `--dir` 模式。递归扫子目录。 |

---

## 二、两种模式

### 模式 A：`--classes`（智能，推荐）

依赖 `logs/success.json` + `check_matches.classify()` 反查。**只改指定分类的文件**，避免对已经正确的 `ok` 类下手。

```bash
# 默认只改 mismatch
python src/rename_by_metadata.py --apply

# 改 mismatch + 所有 warn_* 类
python src/rename_by_metadata.py --apply \
  --classes mismatch,warn_alias_likely,warn_partial_artist,warn_title_diff,warn_no_artist,warn_title_only,ok_no_artist
```

### 模式 B：`--dir`（简单，兜底）

对某个目录下所有音频按内嵌元数据改名，**不查 success.json**。适合 [download_from_urls.md](download_from_urls.md) 下载的、或者从别处挪进来的文件。

```bash
# 只扫第一层
python src/rename_by_metadata.py --dir downloads --apply

# 递归扫所有子目录
python src/rename_by_metadata.py --dir downloads --recursive --apply
```

---

## 三、改名规则

读取文件内嵌标签：

| 格式 | 读取方式 | 字段 |
|------|----------|------|
| `.opus` | mutagen `OggOpus` | Vorbis `artist`, `title` |
| `.m4a` / `.mp4` | mutagen `MP4` | `\xa9ART`, `\xa9nam` |

按以下规则构造新文件名：

```
有 artist + title  →  {artist} - {title}.{ext}
只有 title         →  {title}.{ext}
只有 artist        →  {artist}.{ext}
都没有             →  untitled.{ext}
```

**字符过滤**（`sanitize`）：把 `\ / : * ? " < > |` 及控制字符替换成 `_`，多个空格合并，长度限制 180 字符。

### 同名冲突

如果新文件名在同目录已存在（且不是自己），自动加 ` (2)`、` (3)` 后缀避免覆盖：

```
田馥甄 - 还是要点mp3
田馥甄 - 还是要幸福 (2).mp3
```

### 会跳过的情况

| 情况 | 行为 |
|------|------|
| 计算出的新名 = 当前名 | 跳过，统计为 `unchanged` |
| `success.json` 引用的文件磁盘找不到 | 安静跳过，统计为 `missing` |
| 内嵌标签读不出来（文件损坏）| 跳过，统计为 `unreadable` |

---

## 四、典型用法

### 1. 预览（dry-run）

```bash
# 默认只看 mismatch 类的改名计划
python src/rename_by_metadata.py
```

输出示例：

```
Mode: success.json,  classes=['mismatch'],  files found=14

Plan: 12 renames | unchanged=2 | unreadable=0

  downloads/买辣椒也用券 - 起风了.opus
    -> 蕾雅-起风了.opus

  downloads/A-Lin - 失恋无罪.opus
    -> 黃小楨 - 失戀無罪.opus

  ...

(dry-run — pass --apply to actually rename)
```

### 2. 实际改名（mismatch 类）

```bash
python src/rename_by_metadata.py --apply
```

### 3. 把所有非 ok 类都改一遍

```bash
python src/rename_by_metadata.py --apply \
  --classes mismatch,warn_alias_likely,warn_partial_artist,warn_title_diff,warn_no_artist,warn_title_only,ok_no_artist
```

### 4. 对某目录无脑改（不依赖 success.json）

```bash
python src/rename_by_metadata.py --dir downloads --recursive --apply
```

---

## 五、典型工作流

### 推荐顺序：先分类挪文件，再改名

```bash
# (1) 下载 + 校验
python src/main.py --all
python src/check_matches.py

# (2) 先按分类挪（让 mismatch 集中到一个目录）
python src/organize_by_check.py --apply

# (3) 进 downloads/mismatch/ review
#     对每首歌决定：
#       a) 接受现状（保留文件，但想让文件名反映真实内容）→ 用 rename_by_metadata 改名
#       b) 不要了 → 手动删
#       c) 想换正确版本 → 用 download_from_urls 重下

# (4) 决定保留的，按内嵌元数据改名
python src/rename_by_metadata.py --apply \
  --classes mismatch,warn_alias_likely,warn_partial_artist,warn_title_diff
```

> 改名后文件名就和文件内容一致了，避免了「文件名是 A，点开是 B」的混淆。

---

## 六、和 organize_by_check 的执行顺序

两个工具都依赖 `check_matches.classify()`，但**作用对象不同**：

- `organize_by_check` 挪文件位置 → 改的是**路径**
- `rename_by_metadata` 改文件名 → 改的是**文件名**

**`rename_by_metadata` 不依赖文件位置**——它会从 `downloads/` 根目录开始递归查找 `success.json` 里引用的文件名（`find_file()` 用 `rglob`），所以即使文件已经被 `organize_by_check` 挪进了 `downloads/mismatch/` 子目录，照样能找到并改名。

**推荐顺序**：先 `organize_by_check` 再 `rename_by_metadata`。因为：
1. 分类挪文件后，按类别改名更清晰
2. 顺序无关（两者都能找到文件），但先分类后改名的心理模型更顺

---

## 七、常见问题

### Q: 改完名后，`success.json` 里的 `filepath` 还指向旧名

是的。`success.json` 不会自动更新。这会影响后续 `organize_by_check` / `rename_by_metadata` 的 `find_file`。脚本用 `rglob` 按 basename 查找，所以**只要文件名没改过、还在 `downloads/` 下**就能找到。如果改名后想跑其他工具，建议：

1. 先 `organize_by_check`（挪位置）
2. 再 `rename_by_metadata`（改名字）
3. 之后慎用依赖 `success.json` filepath 的工具

### Q: 文件名变成乱码或 untitled

内嵌标签读不出来或编码异常。先单独检查这个文件：

```bash
ffprobe -hide_banner "/path/to/file.opus" 2>&1 | grep -i -E "title|artist"
```

### Q: 想撤销改名

脚本是 mv 操作，没有内置撤销。可以从 `logs/run_*.log` 找到改名记录，手动 mv 回去。或从 git/备份恢复。

### Q: 改名后 `success.json` 还在引用旧路径，能不能同步更新

当前版本不支持。如需此功能可以扩展，但目前的设计是「success.json 只记录下载时刻的真相，文件位置/名字可以后续自由改」。

---

## 八、相关文档

- [check_matches.md](check_matches.md) — 分类逻辑来源
- [organize_by_check.md](organize_by_check.md) — 按分类挪文件（通常先跑这个）
- [opus2mp3.md](opus2mp3.md) — 改名后转 mp3
- [项目总 README](../README.md)
