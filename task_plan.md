# Task Plan: 批量下载 1128 首歌曲到本地

## Goal
从 `songs_list.txt` 中的 1128 首歌曲(中/日/韩/英文流行音乐),通过 YouTube Music 作为主源批量下载到本地,**保留 YouTube 服务端的原始音频流(无有损二次转码)**,并自动嵌入元数据(歌名、艺术家、封面)。

## Current Phase
Phase 2 — 环境准备(用户已确认方案)

## Phases

### Phase 1: 方案设计与确认 [DONE]
- [x] 读取并分析 songs_list.txt(1128 首,含部分重复/缺艺人项)
- [x] 检查本地环境(yt-dlp 已装,ffmpeg 缺失,Python3 可用)
- [x] 设计技术方案与项目结构
- [x] 确认音频策略:保留原始流,不做有损转码
- [x] 与用户确认剩余项(代理、下载位置、并发数、Premium)
- **Status:** completed

### Phase 2: 环境准备 ← (当前)
- [ ] 安装 ffmpeg(仅用于**封装容器操作和元数据写入**,不做编解码)
- [ ] 安装 Python 依赖:`yt-dlp`(升级到最新)、`mutagen`、`ytmusicapi`
- [ ] 创建项目目录结构
- **Status:** pending

### Phase 3: 核心脚本实现
- [ ] `parse_list.py` — 解析歌单,处理重复项、缺艺人项、特殊符号
- [ ] `downloader.py` — 单首歌下载逻辑(搜索→筛选→下载→嵌元数据)
- [ ] `main.py` — 批量调度、并发、断点续传、日志
- [ ] `config.py` — 配置(并发、代理、过滤词)
- **Status:** pending

### Phase 4: 测试(10 首随机抽样)
- [ ] 从歌单中随机抽 10 首作为测试集(固定 seed 可复现)
- [ ] 跑完整流程,检验音质/元数据/命名/失败兜底
- [ ] 根据结果调参
- **Status:** pending

### Phase 5: 全量下载与交付
- [ ] 跑全部 1128 首
- [ ] 输出 success/failed 报告
- [ ] 对 failed 项给出人工处理建议
- **Status:** pending

---

## 技术方案详解

### A. 工具选型

| 工具 | 角色 | 理由 |
|------|------|------|
| **yt-dlp** | 下载内核 | 最活跃的 YT 下载器,`-f bestaudio` 直接拿到 YouTube 服务端最高质量音频流(opus/m4a),**不做二次编码** |
| **ytmusicapi** | 搜索增强 | 直调 YT Music API,返回结构化结果(title/artist/album/duration/videoId),比 `ytsearch:` 关键字搜更准 |
| **ffmpeg** | 容器封装 + 写标签 | 用 `-c copy` 模式,**不重新编码**音频,仅做容器内元数据/封面写入 |
| **mutagen** | 元数据补丁 | 处理 yt-dlp 写不进去的字段(如 Vorbis comments 对 opus 的支持) |

**为什么不选其他方案:**
- **spotDL**:依赖 Spotify,中文歌库缺很多本歌单里的国语/粤语老歌
- **NetEase/QQ 爬虫**:版权风险高,API 不稳定
- **MusicFree/Listen1**:桌面 GUI,不适合批量脚本化

### B. 音频策略(关键)

**不做任何有损转码**,具体操作:

```
YouTube 服务端音频流(yt-dlp 拿到的)
├── opus 编码 → 装在 .webm/.opus 容器 → 输出 .opus
└── aac/m4a 编码 → 装在 .m4a 容器     → 输出 .m4a
```

- yt-dlp 参数:`-f bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio`
- 优先 m4a(AAC,通用性更好);若该视频只有 opus 流也接受
- 容器封装/标签嵌入用 ffmpeg `-c:a copy`,**bit-for-bit 保留原始音频**
- 实际质量:非 Premium 账号通常 opus ~160kbps / AAC ~128kbps(这是 YouTube 服务端给出的"原始",上面已无更高源)

> 注:如果有 YouTube Music Premium 账号 cookie,可拿到 256kbps AAC。这点等会会问你。

### C. 项目结构

```
YT_Music/
├── songs_list.txt              # 原始歌单
├── task_plan.md / findings.md / progress.md
│
├── src/
│   ├── config.py               # 全局配置
│   ├── parse_list.py           # 歌单解析(去重、拆字段)
│   ├── downloader.py           # 单首下载逻辑
│   └── main.py                 # 批量入口(CLI: --test / --all / --resume)
│
├── downloads/                  # 下载输出(文件名: {Artist} - {Title}.{ext})
├── logs/
│   ├── success.json            # 已完成(断点续传依据)
│   ├── failed.json             # 失败明细(原因+建议)
│   └── run-{timestamp}.log
├── cache/
│   └── search_cache.json       # 搜索结果缓存
└── requirements.txt
```

### D. 单首下载流程

```
歌单行: "起风了-买辣椒也用券"
   ↓
[1] 解析: title="起风了", artists=["买辣椒也用券"]
[2] 构建查询: "起风了 买辣椒也用券"
[3] ytmusicapi.search(query, filter="songs", limit=5)
[4] 筛选最优:
    - 优先 result type=Song(YT Music 官方音轨标记)
    - 时长合理(1-15 分钟)
    - 标题模糊匹配度
    - 排除 cover/karaoke/instrumental/伴奏/翻唱 关键词
[5] yt-dlp 下载 videoId:
    - -f "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
    - 后处理: --embed-thumbnail --embed-metadata(无转码)
    - 输出原始扩展名(.m4a / .opus)
[6] mutagen 二次修正标签(标题/艺人/专辑/封面 兜底)
[7] 文件命名: sanitize("{Artist} - {Title}.{ext}")
[8] 写入 success.json
```

**失败兜底:**
- ytmusicapi 找不到 → 回退到 `yt-dlp ytsearch5:` 普通 YouTube 搜索
- 网络/429 → 重试 3 次(指数退避 2s/8s/32s)
- 全失败 → 写入 failed.json,继续下一首

### E. 关键配置(可调)

```python
# config.py
KEEP_ORIGINAL_AUDIO = True              # 不做有损转码
FORMAT_PREFERENCE = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
EMBED_THUMBNAIL = True                  # 封面嵌入(thumbnail → cover)
EMBED_METADATA = True                   # 标签嵌入

CONCURRENT_DOWNLOADS = 3                # 并发数
RETRY_TIMES = 3
RETRY_BACKOFF = [2, 8, 32]              # 秒

SKIP_KEYWORDS = ["karaoke", "cover", "instrumental",
                 "伴奏", "翻唱", "MMD", "Nightcore"]
DURATION_MIN_SEC = 60
DURATION_MAX_SEC = 900

PROXY = None                            # 例: "http://127.0.0.1:7890"
COOKIES_FROM_BROWSER = None             # 例: "chrome",取 YT Music Premium cookie
SEARCH_RESULTS_LIMIT = 5
```

### F. 测试方案(Phase 4 重点)

1. **随机抽样**:`random.sample(songs, 10)`,固定 seed=42 可复现
2. **样本代表性自检**(若抽到的太集中会重抽):
   - 中文流行(国语/粤语) ≥3
   - 日文(动漫/J-pop) ≥1
   - 韩文(K-pop) ≥1
   - 英文 ≥1
   - 含 `_` 多艺人 ≥1
3. **验证清单**:
   - [ ] ≥9/10 成功
   - [ ] 音频可播放,无破音/无静音
   - [ ] 元数据三件套齐全(歌名/艺人/封面)
   - [ ] 文件名无 `/`、`?`、`*` 等非法字符
   - [ ] 失败有清晰错误原因日志

### G. 歌单数据问题(已扫描出,脚本会处理)

| 问题 | 例子 | 处理 |
|------|------|------|
| 缺艺人 | `Monica-`、`倒数-`、`俩忘烟水里-` | 只用 title 搜,记 warning |
| 同名重复 | `Sorry Sorry-Super Junior` vs `SORRY, SORRY-SUPER JUNIOR` | 归一化(lower+去标点) → 报告给用户决定保留谁 |
| 多艺人 `_` 分隔 | `eight-IU _ SUGA` | 第一个艺人 + 全部进 metadata |
| 标题里有 `-` | `スパークル [original ver.] -Your name. Music Video edition- 予告編 from...-RADWIMPS` | 按**最后一个 `-`** 拆分 |
| 特殊字符 | `secret base ～君がくれたもの～-未闻花名 ED` | 文件名做 unicode 安全替换 |
| `（）` 等中文括号 | `（......恋人絮语）-吴青峰 feat.林嘉欣` | 保留,搜索时也保留 |

### H. 风险与对应

| 风险 | 缓解 |
|------|------|
| 中国大陆无法直连 YouTube | 支持代理参数(http/socks5) |
| 被 YT 限速 / 429 | 并发≤3 + 指数退避 |
| 搜到翻唱/伴奏版 | ytmusicapi 优先 + 关键词过滤 + 时长校验 |
| 元数据缺失/乱码 | 双写: yt-dlp + mutagen 兜底 |
| 中途中断 | success.json 断点续传 |
| opus 容器播放器兼容性 | 优先选 m4a,只有 opus 时才用;现代播放器/iOS 均支持 opus |

---

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 主源用 YouTube Music | 多语言覆盖最广,工具链最成熟 |
| 用 ytmusicapi 而不是纯 ytsearch 关键字 | 搜索精度显著提升,直接拿到结构化元数据 |
| **保留原始音频流,不二次编码** | 用户明确要求,避免有损损失;ffmpeg 仅做容器/标签操作(`-c copy`) |
| 格式优先级: m4a > opus | m4a/AAC 通用性更好,部分老设备不支持 opus |
| 并发 3 | 平衡速度与限速风险(待确认) |
| 测试阶段固定 random seed | 结果可复现,便于调参对比 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| ffmpeg 未安装 | Phase 2 通过 brew 安装 |

---

## 用户最终确认(已锁定)
1. **网络代理**:不需要,直连
2. **下载位置**:`./downloads/`(项目内)
3. **并发数**:3
4. **YT Music Premium**:无,匿名下载(opus ~160kbps / AAC ~128kbps 是音质上限)
5. **音频策略**:保留 YT 原始流,ffmpeg 仅 `-c copy` 容器封装+标签写入,**bit-for-bit 无损**
6. **测试规模**:10 首(固定 seed=42)
