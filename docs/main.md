# main.py — 批量下载入口

读取 `songs_list.txt` 歌单，批量从 YouTube Music 搜索并下载到 `downloads/` 目录。

这是整个项目的**主入口**，串联 [parse_list.md](parse_list.md)（解析歌单）和 [downloader.md](downloader.md)（单首下载）两个模块。

---

## 一、命令行参数

```
usage: main.py [-h] (--test N | --all) [--resume] [--limit LIMIT]

必填（二选一，互斥）:
  --test N            随机抽 N 首测试（固定 seed=42，可复现）
  --all               下载歌单全部歌曲

可选:
  --resume            跳过 logs/success.json 里已成功的（断点续传）
  --limit N           总数限制（调试用，从前面截断）
  -h, --help          查看帮助
```

### 关键参数说明

| 参数 | 作用 |
|------|------|
| `--test N` | 从歌单里**随机**抽 N 首，使用固定 seed（`config.TEST_SEED = 42`），**可复现**。第一次跑用来验证环境。 |
| `--all` | 下载全部。和 `--test` 互斥。 |
| `--resume` | **断点续传**：跳过 `logs/success.json` 里已成功的条目。中途打断、想续跑，或追加新歌后再跑都用它。 |
| `--limit N` | 截断前 N 首（调试用）。 |

---

## 二、典型用法

### 1. 第一次：先测 10 首

```bash
python src/main.py --test 10
```

确认环境正常、下载质量符合预期，再上量。

### 2. 全量下载

```bash
python src/main.py --all
```

### 3. 中途断了，续跑

```bash
python src/main.py --all --resume
```

日志会打印 `Resume: 200 already done, 50 to go`，清楚告诉你跳过了多少。

### 4. 追加新歌到歌单后续跑

往 `songs_list.txt` 末尾加新行，直接：

```bash
python src/main.py --all --resume
```

已下载的会自动跳过，只下新增的。

### 5. 调试：只下前 5 首

```bash
python src/main.py --all --limit 5
```

---

## 三、下载流程（单首歌）

```
歌单行
  ↓ parse_list.parse_line()  按「最后一个 -」切分 title / artists
  ↓ ytmusicapi.search(filter="songs", limit=5)
  ↓ downloader.pick_best()   过滤 karaoke/伴奏/翻唱，降权 Live
  ↓ yt-dlp -f bestaudio[ext=webm]   取 opus 流
  ↓ ffmpeg -c copy            webm → opus（仅换容器，无损）
  ↓ EmbedThumbnail + FFmpegMetadata  写封面/标题/艺人/专辑
  ↓
downloads/{Artist} - {Title}.opus
  ↓
logs/success.json  （断点续传依据）
```

### 失败兜底

| 情况 | 处理 |
|------|------|
| ytmusicapi 找不到 | 回退到 `yt-dlp ytsearch` 普通 YouTube 搜索 |
| 网络/429 | 3 次重试，2s / 8s / 32s 指数退避 |
| 全部失败 | 写入 `logs/failed.json`，**继续下一首**，不中断 |

---

## 四、输出文件

```
downloads/
└── {Artist} - {Title}.opus      ← 音频文件（含嵌入封面与标签）

logs/
├── success.json                  ← 成功条目（断点续传依据）
├── failed.json                   ← 失败明细（含 reason）
└── run_YYYYMMDD_HHMMSS.log       ← 本次运行完整日志
```

### `success.json` 结构（每条）

```json
{
  "起风了-买辣椒也用券": {
    "ok": true,
    "song": {"title": "起风了", "artists": ["买辣椒也用券"], "raw": "起风了-买辣椒也用券"},
    "match": {
      "videoId": "xxx",
      "title": "起风了",
      "artists": ["买辣椒也用券"],
      "duration": "5:25",
      "resultType": "song"
    },
    "download": {
      "video_id": "xxx",
      "yt_title": "起风了",
      "yt_artist": "买辣椒也用券",
      "duration": 325,
      "filepath": "/path/to/downloads/买辣椒也用券 - 起风了.opus"
    }
  }
}
```

> `success.json` 是后续 [check_matches.md](check_matches.md) / [organize_by_check.md](organize_by_check.md) / [rename_by_metadata.md](rename_by_metadata.md) 的数据源，**不要手动删它**，除非你想丢弃全部历史记录重下。

---

## 五、性能

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| `CONCURRENT_DOWNLOADS` | 3 | 并发下载数（在 `config.py` 改）|
| `RETRY_TIMES` | 3 | 单首失败重试次数 |
| `RETRY_BACKOFF` | `[2, 8, 32]` 秒 | 指数退避间隔 |

**典型耗时**：1106 首 × 平均 2.3 秒/首 / 并发 3 ≈ **15 分钟**（网速好的情况下）。

并发开太大容易被 YouTube 限流（429），默认 3 是经验上的稳定值。如要调整，改 `config.py` 的 `CONCURRENT_DOWNLOADS`。

---

## 六、常见问题

### Q: 报错 `Requested format is not available`

yt-dlp 缺 JS 运行时。装 deno：

```bash
curl -fsSL https://deno.land/install.sh | sh
```

或见 [项目 README](../README.md) 的 node 替代方案。

### Q: 全部失败，`failed.json` 满是 `download_error`

多半是网络/代理问题。检查 `config.py` 的 `PROXY` 配置。境内必须配代理。

### Q: 想强制重下某首歌

从 `logs/success.json` 里删掉对应那条，再 `--resume`。或者直接删掉对应的 `.opus` 文件并把那条从 success.json 移除。

### Q: 想要 mp3 而不是 opus

下载链路默认保留原始流（opus）。要 mp3 用 [opus2mp3.md](opus2mp3.md) **事后转码**，不要改下载链路（改了会引入有损二次编码）。

---

## 七、相关文档

- [parse_list.md](parse_list.md) — 歌单格式与解析规则
- [downloader.md](#) — 单首歌下载（搜索→筛选→下载）
- [download_from_urls.md](download_from_urls.md) — 直接用 URL 下载（跳过搜索）
- [opus2mp3.md](opus2mp3.md) — 转码为 mp3
- [项目总 README](../README.md)
