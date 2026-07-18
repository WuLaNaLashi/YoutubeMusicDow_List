# find_duplicates.py — 163 与 YT 跨源去重

对比**网易云（163）下载的 mp3 文件夹**和 **YouTube 下载的 opus/m4a 文件夹**，找出**两处都有的同一首歌**，把 YT 侧的重复项挪到 `may/` 目录。

> 适用场景：你既有网易云又有 YouTube 两个音源，想合并成一个本地库时，避免同一首歌存两份。

---

## ⚠️ 重要说明

这个脚本**路径是硬编码**的，专为作者本人的目录结构写：

```python
MP3_DIR = Path("/home/hanxiao/Music/163")
YT_DIR  = Path("/home/hanxiao/Music/YouTube-20260520")
DEST_DIR = Path("/home/hanxiao/Music/may")
```

**如果你不是作者本人，或目录结构不同，必须先改这三个常量**才能运行。

---

## 一、命令行参数

**无命令行参数**。直接运行：

```bash
python find_duplicates.py
```

> 注意：这个脚本在**项目根目录**，不在 `src/` 下。

---

## 二、典型用法

### 1. 运行（默认会直接移动文件，无 dry-run）

```bash
cd /home/hanxiao/Music/YoutubeMusicDow_List
python find_duplicates.py
```

输出示例：

```
已加载 1106 条分类记录
163  (mp3):  500 首
YT   (opus/m4a): 1106 首

匹配:   312 首
无匹配: 794 首

============================================================
匹配详情 (前 30 条):
  田馥甄 - 还是要幸福.opus
    <-> 田馥甄 - 还是要幸福.mp3
  ...

将 312 个文件移至 /home/hanxiao/Music/may ...
完成。
```

---

## 三、匹配逻辑（核心）

### 命名不确定性

163 和 YT 两个文件夹的命名规则都不确定，都可能出现：
- `Title - Artist`（标题在前）
- `Artist - Title`（艺人在前）

### 双策略解析

**每个文件名同时用两种策略各解析一次**：

| 策略 | 切分方式 | 示例 `A - B` |
|------|----------|-------------|
| 策略 A（title-first）| 按**最后一个** `-` 或 ` - ` 切 | title=`A`, artist=`B` |
| 策略 B（artist-first）| 按**第一个** ` - ` 切 | artist=`A`, title=`B` |

### 2×2 比较

每个 YT 文件的 2 种解析 × 每个 163 文件的 2 种解析 = **4 轮比较**，只要有一组匹配上就算重复。

### 相似度阈值

```python
def is_match(t1, a1, t2, a2):
    return title_sim >= 0.85 and artist_sim >= 0.80
```

- **标题相似度** ≥ 0.85（用 `SequenceMatcher.ratio()`）
- **艺人相似度** ≥ 0.80（多艺人时取首位艺人匹配）

### 归一化预处理

算相似度前，对标题/艺人都做归一化：
- 小写
- 去括号内容（含全角）
- 去 `live` / `remix` / `acoustic` 等后缀
- 统一艺人分隔符（`、` `&` ` _ ` → `,`）
- 去非关键标点

### 一个 mp3 只匹配一次

```python
if mp3_f in {m[1] for m in matches}:
    continue  # 已匹配过的 mp3 跳过
```

避免一个 163 文件被多个 YT 文件重复匹配。

---

## 四、输出

### 控制台

打印：
1. 各目录文件数
2. 匹配数 + 无匹配数
3. 匹配详情（前 30 条）
4. 移动结果

### 文件操作

把匹配上的 **YT 侧**文件从 `YT_DIR` 移到 `DEST_DIR`（默认 `/home/hanxiao/Music/may`）：

```
YouTube-20260520/田馥甄 - 还是要幸福.opus   →   may/田馥甄 - 还是要幸福.opus
```

> **为什么移 YT 而不移 163**：163 通常是 mp3，YT 是 opus/m4a。设计上保留 163 的 mp3（兼容性更好），把 YT 的副本挪走。

---

## 五、可选配置

### 只处理某些分类

脚本顶部有 `ONLY_CLASSES` 常量：

```python
ONLY_CLASSES = None  # 全量扫描
# ONLY_CLASSES = {"warn_alias_likely", "mismatch", ...}  # 只扫这些分类
```

它会尝试从 `logs/success.json` 加载每首歌的 `check_class` 字段，如果设了 `ONLY_CLASSES`，只处理这些分类的 YT 文件。

**但注意**：`load_class_map()` 期望 `success.json` 是**列表**格式（`for entry in data`），而项目当前的 `success.json` 是 **dict**（key 是 raw 字符串）。所以这段代码可能不工作，需要你手动改一下，或干脆设 `ONLY_CLASSES = None` 全量扫描。

---

## 六、常见问题

### Q: 报错 `FileNotFoundError`，目录不存在

确认顶部三个路径常量指向真实存在的目录：

```python
MP3_DIR  = Path("/your/path/to/163")
YT_DIR   = Path("/your/path/to/YT")
DEST_DIR = Path("/your/path/to/may")
```

### Q: 误匹配（不是同一首歌被判重复）

阈值 `0.85 / 0.80` 是经验值。如果误匹配多，调高：

```python
return title_sim >= 0.90 and artist_sim >= 0.85
```

### Q: 漏匹配（同一首歌没被识别）

阈值太高，或归一化不够。检查具体例子，可能需要扩充归一化规则（比如加简繁转换）。

### Q: 没有干跑模式，怕误移

脚本直接 move，没有 dry-run。**建议先备份** YT 目录，或在 move 那行加个确认：

```python
# 在 main() 里移动前加
resp = input(f"确认移动 {len(matches)} 个文件? [y/N] ")
if resp.lower() != 'y':
    return
```

或把 `shutil.move` 改成 `shutil.copy2` 先复制，确认无误后再删源。

### Q: 想反过来，移 163 保留 YT

改 `main()` 末尾的移动逻辑，把 `src = YT_DIR / yt_f` 改成 `src = MP3_DIR / mp3_f`，对应调整。

---

## 七、相关文档

- [main.md](main.md) — YT 文件的来源
- [check_matches.md](check_matches.md) — 分类来源（本脚本尝试读 success.json 的 class）
- [项目总 README](../README.md)
