# download_from_urls.py — 用 YouTube URL 直接下载

跳过搜索匹配环节，**直接用一组 YouTube 链接**下载音频。适合你已经手上有 videoId/URL（比如从 [check_matches.md](check_matches.md) 的 mismatch 里手动找到正确版本），不想再走歌单搜索流程。

---

## 一、命令行参数

```
usage: download_from_urls.py [-h] (--file FILE | --urls URL [URL ...])
                             [--resume] [--limit LIMIT]

必填（二选一，互斥）:
  --file FILE         文本文件路径，每行一个 YouTube URL（支持 # 注释）
  --urls URL [URL ...] 命令行直接给一个或多个 URL

可选:
  --resume            跳过 logs/url_success.json 里已成功的
  --limit N           限制处理数量（调试用）
  -h, --help          查看帮助
```

---

## 二、支持的 URL 格式

脚本用正则提取 11 位 videoId，常见格式都能识别：

| 格式 | 示例 |
|------|------|
| 标准 watch URL | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` |
| 短链 | `https://youtu.be/dQw4w9WgXcQ` |
| embed | `https://www.youtube.com/embed/dQw4w9WgXcQ` |
| Shorts | `https://www.youtube.com/shorts/dQw4w9WgXcQ` |
| 带 query 参数 | `https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=...&t=42` |
| music.youtube.com | `https://music.youtube.com/watch?v=dQw4w9WgXcQ` |

**去重**：基于提取的 videoId 去重（同一视频不同 URL 形式只下一次）。

**注释**：`--file` 文件支持 `#` 开头的行作为注释，跳过空行。

---

## 三、典型用法

### 1. 从文件批量下载

准备 `songs_url_list.txt`：

```
# 这首是 mismatch 后手动确认的正确版本
https://www.youtube.com/watch?v=oe8xkNYozjg

# 翻唱版
https://youtu.be/xxxxxxxxxxx
```

跑：

```bash
python src/download_from_urls.py --file songs_url_list.txt
```

### 2. 直接命令行给 URL

```bash
python src/download_from_urls.py --urls \
  https://www.youtube.com/watch?v=oe8xkNYozjg \
  https://youtu.be/xxxxxxxxxxx
```

### 3. 断点续传

```bash
python src/download_from_urls.py --file songs_url_list.txt --resume
```

### 4. 先下 3 个测一下

```bash
python src/download_from_urls.py --file songs_url_list.txt --limit 3
```

---

## 四、输出文件

和 [main.md](main.md) 一样输出到 `downloads/`，命名规则：

```
{uploader/artist} - {title}.opus
```

> 因为没走搜索流程，**文件名基于 YouTube 返回的 `uploader`/`artist` 字段**，不是歌单里的（这里压根没有歌单）。

### 日志和状态文件

| 文件 | 说明 |
|------|------|
| `logs/url_success.json` | URL 模式专属的成功记录（和 `success.json` 分开）|
| `logs/url_failed.json` | 失败明细 |
| `logs/run_urls_YYYYMMDD_HHMMSS.log` | 运行日志（注意带 `urls_` 前缀，和 main 的日志区分）|

> URL 模式的成功记录**单独存**在 `url_success.json`，不会污染歌单模式的 `success.json`，所以 [check_matches.md](check_matches.md) 等「依赖 success.json」的工具不会把 URL 下载的歌纳入校验。

---

## 五、下载链路

和 [main.md](main.md) **完全相同**：

- 复用 `downloader._build_ydl_opts()` 构造 yt-dlp 配置（同样格式偏好、cookies、代理）
- 同样优先 opus，同样嵌入封面与元数据
- 同样 3 路并发，同样 3 次重试

区别只在前置：**main 先搜索再下载，download_from_urls 直接拿 URL 下载**。

---

## 六、典型场景

### 场景 A：修正 mismatch

跑完 [main.md](main.md) + [check_matches.md](check_matches.md) 后，发现 `mismatch` 分类里有几首歌下错了。你手动在 YouTube 搜到正确的 videoId，把它们写进 `songs_url_list.txt`：

```bash
python src/download_from_urls.py --file songs_url_list.txt
```

下到正确版本后，可以删除旧文件、或用 [rename_by_metadata.md](rename_by_metadata.md) 整理。

### 场景 B：下载不在 YT Music 编录的特定版本

[main.md](main.md) 默认搜 `filter="songs"`，只会命中 YT Music 正版编录。如果你想要某个用户上传的 Live / Remix / MV 版本，只能用 URL 模式。

---

## 七、常见问题

### Q: 报错 `unsupported URL`

URL 格式没识别出来。检查是不是漏了 `https://`，或者用了上面表格里没列出的格式。看一眼 `_YT_ID_RE` 正则确认。

### Q: 文件名很奇怪

URL 模式没走歌单，文件名直接来自 YouTube。如果 uploader 字段乱七八糟（比如某些自动频道），下载后用 [rename_by_metadata.md](rename_by_metadata.md) 改名。

### Q: 想把 URL 模式下的歌也纳入匹配校验

目前不支持。`check_matches.py` 依赖歌单字段（用户期望的 title/artist），URL 模式没有这个对照基准。如果确实需要，可以用 [list_non_catalog.md](list_non_catalog.md) 检查它们是不是正版编录。

---

## 八、相关文档

- [main.md](main.md) — 歌单搜索模式（对比参考）
- [rename_by_metadata.md](rename_by_metadata.md) — URL 模式下载的文件名需要整理时
- [项目总 README](../README.md)
