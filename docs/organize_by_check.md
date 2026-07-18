# organize_by_check.py — 按分类挪文件

把 `downloads/` 里的音频文件按 [check_matches.md](check_matches.md) 的分类挪进同名子目录，方便你集中 review 某一类（比如把所有 `mismatch` 放一个文件夹里逐个看）。

**幂等**：可以反复跑，已经在正确目录的文件不动，挪错的会修正。

---

## 一、命令行参数

```
usage: organize_by_check.py [-h] [--apply] [--copy] [--dry-run]

可选:
  --apply          实际执行（默认 dry-run）
  --copy           复制而非移动（配合 --apply 用）
  --dry-run        只预览不挪（默认就是这个）
  -h, --help       查看帮助
```

### 关键参数说明

| 参数 | 作用 |
|------|------|
| `--apply` | **安全开关**。默认 dry-run，只打印计划。确认无误再加 `--apply`。 |
| `--copy` | 默认是**移动**（move）。加 `--copy` 变成**复制**（保留原位置）。配合 `--apply` 用。 |
| `--dry-run` | 显式写 dry-run（其实就是默认行为）。 |

---

## 二、典型用法

### 1. 预览（dry-run，默认）

```bash
python src/organize_by_check.py
```

输出示例：

```
Classification distribution (from check_matches):
  ✅ ok                      732
  🔵 warn_alias_likely       298
  ❌ mismatch                 14
  ⚠️ warn_title_diff          30
  ...

Plan: 44 files to move into subfolders.
  -> downloads/mismatch/  (14)
  -> downloads/warn_title_diff/  (30)

(dry-run — pass --apply to actually move)
```

### 2. 实际挪文件（移动）

```bash
python src/organize_by_check.py --apply
```

### 3. 复制而非移动（保留原位置）

```bash
python src/organize_by_check.py --apply --copy
```

---

## 三、输出布局

挪完后，`downloads/` 会变成这样：

```
downloads/
├── ok/                          ✅ 艺人+标题都对
├── warn_alias_likely/           🔵 标题完全一致艺人字面不同（罗马音/艺名）
├── warn_partial_artist/         ⚠️ 艺人字符部分相交
├── warn_title_diff/             ⚠️ 艺人对但标题差异大
├── mismatch/                    ❌ 真错了，优先 review
└── ok_no_artist/                🟡 歌单原始缺艺人字段
```

完整分类含义见 [check_matches.md 的分类体系](check_matches.md#四匹配分类体系核心)。

---

## 四、幂等性

这个脚本是**幂等**的，可以放心反复跑：

- 文件已经在正确子目录 → 跳过（统计在 `already-in-folder`）
- 文件在错误子目录 → 挪到正确的
- 文件在根目录 → 挪到对应子目录
- `success.json` 里的文件磁盘上找不到 → 安静跳过，统计在 missing

所以以下操作都安全：
- 删了某个子目录后重跑 → 文件重新归类
- 手动挪动过文件后重跑 → 自动修正
- 调整分类规则后重跑 → 按新规则重新归类

---

## 五、分类规则来源

本脚本 **import `check_matches.py` 里的 `classify()` 函数**，分类逻辑和 [check_matches.md](check_matches.md) 完全一致。修改分类阈值只需改 `check_matches.py` 一处。

---

## 六、典型工作流

### 1. 下载 → 校验 → 分类 → review

```bash
# (1) 下载
python src/main.py --all

# (2) 校验（生成报告）
python src/check_matches.py

# (3) 看报告，心里有数后，按分类挪文件
python src/organize_by_check.py --apply

# (4) 进 downloads/mismatch/ 逐首 review
#     决定每首去留：手动删除 / 用 download_from_urls 重下 / 接受
```

### 2. review 完，把剩下的 ok 扁平化回根目录

review 完非 ok 类后，如果想把 ok 类的文件挪回根目录（比如转码前要扁平化），可以手动：

```bash
# 把 ok 子目录里的文件挪回根
mv downloads/ok/*.opus downloads/
rmdir downloads/ok
```

或者保持子目录结构也行，[opus2mp3.md](opus2mp3.md) 的 `--recursive` 会扫子目录。

---

## 七、常见问题

### Q: 跑完发现 `success.json` 里的文件磁盘找不到（missing）

文件被手动删了或挪到项目外了。脚本会列出来。可以选择：
- 从 `success.json` 删掉对应条目（彻底放弃）
- 把文件挪回 `downloads/` 再重跑

### Q: 文件已经在子目录里了，但脚本还要挪它

可能是分类规则变了（你改了 `check_matches.py`），导致它归到了不同的类。让它挪就是了。

### Q: 想自定义分类映射（比如把所有 warn_* 合在一起）

目前不支持。要么改 `check_matches.py` 的 `classify()` 增加新分类，要么挪完后手动合并子目录。

---

## 八、相关文档

- [check_matches.md](check_matches.md) — 分类逻辑来源
- [rename_by_metadata.md](rename_by_metadata.md) — 配合使用，按内嵌元数据改名
- [main.md](main.md) — 数据来源
- [项目总 README](../README.md)
