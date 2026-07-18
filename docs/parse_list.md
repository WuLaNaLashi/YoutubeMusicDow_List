# parse_list.py — 歌单解析

把 `songs_list.txt` 文本文件解析成结构化的 `[{title, artists, raw}, ...]` 列表，供 [main.md](main.md) 使用。

通常**不直接运行**，是 `main.py` 的依赖模块。但也提供 `__main__` 入口，用于**预览解析结果**、检查歌单格式有没有问题。

---

## 一、歌单格式

`songs_list.txt`，**UTF-8 编码**，每行一首歌：

```
歌名-艺人
```

### 规则

| 规则 | 说明 |
|------|------|
| **分隔符是最后一个 `-`** | 因为有些歌名本身含 `-`（如 `スパークル [original ver.] -...-RADWIMPS`）|
| **多艺人用 ` _ ` 分隔** | 空格-下划线-空格（注意不是单个 `_`）|
| **缺艺人可以只写 `歌名-`** | 精度会下降，会被标 `ok_no_artist` |
| **中/英/日/韩混合都支持** | — |

### 示例

```
起风了-买辣椒也用券
そばにいるね (留在我身边)-青山黛玛 _ SoulJa
Letting Go-汪苏泷 _ 吉克隽逸
Monica-
```

### 已知数据陷阱

脚本会尽力处理但不保证：

| 陷阱 | 说明 |
|------|------|
| **艺人/歌名写反** | 如 `いきものがかり-ブルーバード` 实际艺人是 `いきものがかり`，歌名是 `ブルーバード`。脚本按「最后一个 -」切分会反着切。YT 搜索的容错通常能救回来。 |
| **含 `-` 的艺人名** | `A-Lin`、`F.I.R.` 会被解析器切错（`无人知晓的我-A-Lin` 拆成 title=`无人知晓的我-A` artist=`Lin`）。YT 搜索通常能救。 |
| **完全相同歌名 + 不同艺人** | 如 `离别的车站-赵薇` 和 `离别的车站-卓依婷`，脚本会**保留全部**。 |

---

## 二、自动去重策略

### 策略 1：精确去重

标题和艺人归一化后完全一致 → **丢弃后面的**。

归一化方式：小写 + 去掉所有非字母数字（含中文标点）。

```
起风了-买辣椒也用券
起风了 - 买辣椒也用券       ← 归一化后相同，丢弃
```

### 策略 2：软去重

如果同一标题既有「无艺人」版本又有「带艺人」版本，**丢弃无艺人那个**：

```
Monica-                    ← 缺艺人
Monica-张国荣              ← 有艺人，保留这个，丢上面那个
```

---

## 三、单独运行（预览解析结果）

```bash
# 用默认路径（项目根的 songs_list.txt）
python src/parse_list.py

# 指定路径
python src/parse_list.py /path/to/my_songs_list.txt
```

输出示例：

```
Loaded 1106 unique songs.
First 5:
{"title": "起风了", "artists": ["买辣椒也用券"], "raw": "起风了-买辣椒也用券"}
{"title": "そばにいるね (留在我身边)", "artists": ["青山黛玛", "SoulJa"], "raw": "..."}
...

No-artist entries (sample):
{"title": "Monica", "artists": [], "raw": "Monica-"}
```

**用途**：写完歌单后跑一下，确认：
1. 解析出的歌曲数量符合预期
2. `artists` 字段切分正确（多艺人被拆开）
3. `No-artist entries` 数量在可控范围（太多说明歌单质量差）

---

## 四、解析流程（内部逻辑）

```python
def parse_line(line):
    s = line.strip()
    if not s:                          # 空行
        return None
    idx = s.rfind("-")                 # 找最后一个 "-"
    if idx == -1:                      # 整行没 "-"，整行当 title
        return {"title": s, "artists": [], "raw": s}
    title = s[:idx].strip()
    artist_str = s[idx+1:].strip()
    if not title:                      # title 为空，无效行
        return None
    artists = [a.strip() for a in artist_str.split("_") if a.strip()]
    return {"title": title, "artists": artists, "raw": s}
```

---

## 五、字段含义

每首歌解析成一个 dict：

| 字段 | 类型 | 含义 |
|------|------|------|
| `title` | `str` | 歌名 |
| `artists` | `list[str]` | 艺人列表（可能为空）|
| `raw` | `str` | 原始行（去首尾空白后）|

`raw` 字段重要：[main.md](main.md) 用它作为 `success.json` 的 key，确保**同一首歌在多次运行间能对得上**。

---

## 六、常见问题

### Q: 艺人字段切错了

检查歌单里用的分隔符。规则是：
- 歌名/艺人分隔：**最后一个 `-`**
- 多艺人分隔：**` _ `（空格-下划线-空格）**

如果你的歌单用了别的分隔符（如 `、` 或 `&`），需要手动替换。

### Q: 想保留「无艺人」版本

脚本会自动丢弃「同标题的无艺人版本」。如果想保留，注释掉 `load_songs()` 里的软去重逻辑（约 75-78 行）。

### Q: 想从其他格式导入歌单（如 CSV）

本脚本只认 `songs_list.txt` 格式。可以写个转换脚本，或手动调整歌单格式。

---

## 七、相关文档

- [main.md](main.md) — 调用本模块的入口
- [项目总 README](../README.md)
