# check_matches.py — 下载匹配校验

跑完 [main.md](main.md) 后，**对照「用户在歌单里写的」和「实际下载到的」**，给出一份分级报告 `logs/match_report.md`，让你快速定位下错的歌。

这是质量控制的核心工具，**强烈建议每次下载后都跑一遍**。

---

## 一、命令行参数

```
usage: check_matches.py [-h] [--check-files] [-o OUT]

可选:
  --check-files       额外读 .opus/.m4a 磁盘内嵌元数据（慢但更准）
  -o, --out OUT       报告输出路径，默认 logs/match_report.md
  -h, --help          查看帮助
```

### 关键参数说明

| 参数 | 作用 |
|------|------|
| `--check-files` | 默认只对比 `success.json` 里 ytmusicapi 返回的元数据。加上后会**额外读磁盘上 .opus 文件的内嵌标签**做交叉校验，更慢但更准。日常 review 一般不用加。 |
| `-o` | 自定义报告路径。默认 `logs/match_report.md`。 |

---

## 二、典型用法

### 1. 生成报告（默认）

```bash
python src/check_matches.py
```

输出到 `logs/match_report.md`，并在终端打印分类统计：

```
Report: logs/match_report.md
Summary: total=1106  ✅ok=732  🔵warn_alias_likely=298  ⚠️warn_title_diff=...

⚠️  Found 14 mismatches — review the top of the report first.
```

### 2. 启用磁盘元数据交叉校验

```bash
python src/check_matches.py --check-files
```

### 3. 输出到自定义路径

```bash
python src/check_matches.py -o /tmp/my_report.md
```

---

## 三、报告结构

打开 `logs/match_report.md`，从上到下依次是：

1. **总览**：各类标签的数量统计
2. **分级说明表**：每个标签的含义
3. **❌ 不匹配（mismatch）**：**最优先 review** 的部分。每首展开成独立小节，含请求字段、实际字段、videoId、相似度等
4. **🔵 / ⚠️ 各类警告桶**：标题一致但艺人字面不同、艺人部分相交等，按类别归桶列表
5. **💥 下载失败**：来自 `failed.json`
6. **✅ 看起来正确**：折叠展示，默认收起

---

## 四、匹配分类体系（核心）

`classify()` 把每首歌归到下面 8 类之一：

| 标签 | 含义 | 触发条件 |
|------|------|----------|
| ✅ `ok` | 艺人+标题都对 | artist=exact, title_sim ≥ 0.55 |
| 🟡 `ok_no_artist` | 歌单原始缺艺人，只能按标题判断 | requested artists 为空, sim ≥ 0.7 |
| 🔵 `warn_alias_likely` | 艺人字面不同**但标题完全一致** | astat=none, sim ≥ 0.92；或 astat=exact 且请求标题是匹配标题的子串且非 medley |
| ⚠️ `warn_partial_artist` | 艺人字符仅部分相交 | astat=partial |
| ⚠️ `warn_no_artist` | YT 返回的艺人为空 | astat=no_matched |
| ⚠️ `warn_title_only` | 歌单缺艺人 + 标题也对不太上 | requested 为空, sim < 0.7 |
| ⚠️ `warn_title_diff` | 艺人对但标题差异大且非「内嵌子串」 | astat=exact, sim < 0.55, 非子串或 medley |
| ❌ `mismatch` | 艺人不同 + 标题也明显不同 | astat=none, sim < 0.92, 非子串或 medley |

### 判定原理

1. **title_similarity**：对请求和匹配标题分别剥离括号注解、` - 罗马音`后缀，opencc 繁简归一，再算 `difflib.SequenceMatcher.ratio()`，取最大值。
2. **artist_match**：归一化后做 substring 双向比对，返回 `exact` / `partial` / `none` / `no_requested` / `no_matched`。
3. **medley 检测**：关键词 `Medley/连环炮/串烧/组曲` 或括号外 ≥2 个 `/` 分隔符，防止「金曲连环炮」因为包含目标歌名被误判同曲。
4. **classify**：综合 sim + 艺人匹配 + medley 标记，给出 8 级标签之一。

### 真实测试数据（1106 首）

| 分类 | 占比 | 典型例子 |
|------|------|----------|
| ✅ ok | ~66% | 完美匹配 |
| 🔵 warn_alias_likely | ~27% | 米津玄师 ↔ Kenshi Yonezu（罗马音/艺名差异）|
| ⚠️ 各类 warn | ~6% | 需要人工 review |
| ❌ mismatch | ~1.3% | 真的下错了 |

---

## 五、典型工作流

### 1. 跑完下载后立刻 review

```bash
# (1) 下载
python src/main.py --all --resume

# (2) 校验
python src/check_matches.py

# (3) 打开 logs/match_report.md，从 mismatch 开始看
#     对每首 mismatch，决定：
#       a) 接受现状（ YT 上确实没有更好的版本）
#       b) 手动找正确 videoId，用 download_from_urls 重下
#       c) 改用其他源（NetEase / QQ Music）
```

### 2. 改完分类规则后重新评估

`classify()` 逻辑写死在本文件里。调整阈值或规则后，**直接重跑 `check_matches.py` 即可**，不需要重新下载（它只读 `success.json`）。

---

## 六、和 organize_by_check / rename_by_metadata 的关系

这三个工具共享同一套分类逻辑：

| 工具 | 作用 |
|------|------|
| **check_matches** | 生成报告 + 计算每首的 `cls`（内存中） |
| [organize_by_check](organize_by_check.md) | **重新算一遍** `cls`，按类别把文件挪进 `downloads/{cls}/` 子目录 |
| [rename_by_metadata](rename_by_metadata.md) | **重新算一遍** `cls`，把指定类别的文件按内嵌元数据改名 |

> `cls` **不持久化**，每次现算。所以三个脚本的分类逻辑必须保持一致——它们都 import `check_matches.py` 里的 `classify()`，改一处即可。

---

## 七、常见问题

### Q: mismatch 数量异常多

可能 `config.py` 的 `SKIP_KEYWORDS` / `DEPRIORITIZE_KEYWORDS` 配错，或 `pick_best()` 的评分逻辑被改坏了。先查 [main.md](main.md) 的下载日志。

### Q: 某首歌明明是对的，却被标 mismatch

`check_matches` 是字面相似度匹配，对以下情况容易误判：
- **跨语言同曲**：`金达莱花-Maya` 实际是 `Azalea (진달래꽃)` by MAYA（韩文原版）
- **单字标题**：长度 < 2 会跳过子串检测
- **艺人写反**：`いきものがかり-ブルーバード` 这种「艺人-歌名」反着写的会被解析错

这种 false positive 手动跳过即可。

### Q: 报告里的 `exists=false` 是怎么回事

文件被手动删了或挪走了，但 `success.json` 还留着记录。可以忽略，或清理 success.json。

---

## 八、相关文档

- [organize_by_check.md](organize_by_check.md) — 按本工具的分类挪文件
- [rename_by_metadata.md](rename_by_metadata.md) — 按本工具的分类改名
- [main.md](main.md) — 数据来源
- [项目总 README](../README.md)
