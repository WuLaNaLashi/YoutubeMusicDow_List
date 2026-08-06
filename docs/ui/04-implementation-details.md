# YT_Music UI 逐功能实现详解

> 版本:v0.1  日期:2026-08-06  分支:`feat/ui-integration`
> 依赖:`03-implementation-strategy.md`
> 目的:把"现有功能在新方案里靠什么实现"展开到**代码级**,并补充所有候选方案。

本文档对每个现有功能,给出:
1. **现状**(现有 Python 怎么做)
2. **TS 全栈方案怎么实现**(附代码示意)
3. **其他语言方案怎么实现**(Rust/Go)
4. **重写难度与风险**

---

## 候选方案全集(含之前未列的)

在 §3 三个路径之外,还有几个值得知道的选项。先全列,后评估。

| 方案 | 后端语言 | 桌面壳 | 编译产物 | 体积 | 备注 |
|------|---------|--------|----------|------|------|
| **A** 保留 Python | Python(FastAPI) | Tauri | 带 CPython 运行时 | 60-100MB+ | 复用现有,分发重 |
| **B** TS 全栈 | TypeScript + Rust 薄壳 | Tauri | 原生二进制 | 15-25MB | **推荐** |
| **B+** TS + 可选 Python 插件 | TS + 可选 ytmusicapi | Tauri | 原生 + 可选 Python | 15-25MB / +50MB | 精度可 opt-in |
| **C** 全 Rust | Rust | Tauri | 原生二进制 | 12-20MB | 性能最强,字符串/相似度处理啰嗦,开发慢 |
| **D** Go 后端 | Go | Tauri / Wails | Go 单二进制 | 20-30MB | Go 编译干净、生态够、比 Rust 好写 |
| ~~E~~ 纯 Node + Electron | Node | Electron | 带 Node 运行时 | 100-150MB | 前面已因体积排除 |
| ~~F~~ 纯 Web 应用 | 无 | 浏览器 | — | — | 文件系统/cookies 受限,排除 |

**新增评估:**

- **C(全 Rust)**:Tauri 本就是 Rust,全 Rust 的话心智最统一、性能最好。但 Rust 写"歌单解析、字符串相似度、8 级分类"这类逻辑很啰嗦(所有权/生命周期),开发速度比 TS 慢 2-3 倍。**适合追求极致,不推荐首版。**
- **D(Go 后端 + Tauri)**:Go 编译成单二进制、跨平台干净、字符串/正则处理比 Rust 友善、有 `go-ytmusicapi` 社区移植。**如果团队更熟 Go,B 和 D 都是好选择。** 体积比 B 略大(Go runtime ~10MB),但仍远小于 A。

**为什么仍首推 B(TS)而非 C/D**:Tauri 应用里,前端已经是 TS;把"应用逻辑"也放在 TS(跑在 WebView 的 Web Worker 或 Tauri 的 JS sidecar),整个应用只有一种应用层语言,Rust 层退化为纯模板(spawn 进程 + fs)。这是 Tauri 生态最主流、最快上手的写法。除非有强 Go/Rust 背景或极致性能要求,否则没必要换。

> 下面所有功能展开以 **B(TS 全栈)** 为主线;C/D 的差异在每个功能里点出。

---

## 功能 1:歌单解析 — `parse_list.py`

### 现状(Python,45 行核心)
```python
def parse_line(line):
    s = line.strip()
    idx = s.rfind("-")           # 按最后一个 '-' 切分
    if idx == -1:
        return {"title": s, "artists": [], "raw": s}
    title = s[:idx].strip()
    artist_str = s[idx+1:].strip()
    artists = [a.strip() for a in artist_str.split("_") if a.strip()]
    return {"title": title, "artists": artists, "raw": s}
```

### TS 实现(~30 行)
```ts
interface Song { title: string; artists: string[]; raw: string }

function parseLine(line: string): Song | null {
  const s = line.trim();
  if (!s) return null;
  const idx = s.lastIndexOf("-");
  if (idx === -1) return { title: s, artists: [], raw: s };
  const title = s.slice(0, idx).trim();
  const artistStr = s.slice(idx + 1).trim();
  const artists = artistStr
    ? artistStr.split("_").map(a => a.trim()).filter(Boolean)
    : [];
  return { title, artists, raw: s };
}

// 去重逻辑同 parse_list.load_songs,纯集合操作,TS Set 即可
```

### 其他方案
- **Rust**:用 `str::rfind` + `split('_')`,逻辑相同,但要处理 `&str` 借用。
- **Go**:`strings.LastIndex` + `strings.Split`,几乎逐行对应。

### 重写难度:⭐ 极低
纯字符串操作,无外部依赖,任何语言都是几十行。**这是最无争议可重写的部分。**

---

## 功能 2:YT Music 搜索 — `downloader.py:search_song`

### 现状(Python)
```python
from ytmusicapi import YTMusic
ytm = YTMusic()
results = ytm.search("起风了 买辣椒也用券", filter="songs", limit=5)
# results: [{title, artists:[{name}], duration, videoId, resultType:"song", ...}]
```
**`ytmusicapi` 是 Python 独占**,它反向工程 YT Music 私有 API,`filter="songs"` 能精准命中正版目录(由 Topic 频道自动生成)。

### 方案 B(TS)实现:用 yt-dlp 自带的搜索

yt-dlp 内置搜索引擎,直接当子进程调:
```bash
yt-dlp "ytsearch5:起风了 买辣椒也用券" --flat-playlist --dump-json
```
返回 5 条 JSON,每条含:`id`(videoId)、`title`、`uploader`、`duration`、`view_count`。

TS 侧(Rust spawn,详见功能 4 的子进程封装):
```ts
// Rust Command spawn → 流式拿 stdout → 逐行 JSON.parse
const results = await invoke('run_ytdlp', {
  args: ['ytsearch5:起风了 买辣椒也用券', '--flat-playlist', '--dump-json']
});
// results: Array<{id, title, uploader, duration, view_count}>
```

### 精度差异(关键,诚实说)
| 维度 | ytmusicapi | yt-dlp ytsearch |
|------|-----------|-----------------|
| 命中正版目录 | ✅ `filter="songs"` 直取 Topic 频道 | ⚠️ 混入 MV/Live/翻唱,需 `pick_best` 筛 |
| 艺人字段 | ✅ 结构化 `artists:[{name,id}]` | ⚠️ 只有 `uploader`(可能是频道名) |
| `resultType` 区分 song/video | ✅ | ❌ 需自己判断 |

**落差靠谁兜底**:`pick_best` 的打分逻辑(功能 3)+ `check_matches` 的 8 级分类(功能 7)。
搜索差一点 → 筛选打分补偿 → 还漏的 → 校验分类暴露给你 review → 你点"重下"。
**整条质量链是兜底设计,搜索精度不是单点依赖。**

### 想要 ytmusicapi 同等精度?
- **方案 B+**:把 ytmusicapi 包成 ~30 行 Python 脚本当可选子进程(用户装 Python 才启用)。
- **方案 D(Go)**:有社区移植 `github.com/budiirawan/go-ytmusicapi`(完整度不如 Python 版,但可用)。
- **自己反向工程**:YT Music 是 HTTP POST + 签名,工作量大(几千行),不推荐。

### 重写难度:⭐⭐ 中(逻辑易,精度有落差)

---

## 功能 3:候选筛选打分 — `downloader.py:pick_best`

### 现状(Python,~70 行)
关键词黑名单过滤 → 时长过滤 → 标题子串匹配加分(+20)→ 艺人匹配加分(+10)→ song 类型加分(+5)→ live/acoustic 降权(-15)→ 取最高分。

### TS 实现(逐行对应,~70 行)
```ts
function norm(s: string): string {
  return opencc.t2s(s).toLowerCase().replace(/[\s\W_]+/g, "");
}

function pickBest(
  results: SearchResult[], title: string, artists: string[],
  skipKeywords: string[], durMin: number, durMax: number,
  deprioritize: string[], skipArtist: string[]
): SearchResult | null {
  const nt = norm(title);
  const nArtists = artists.map(norm);
  const skip = skipKeywords.map(k => k.toLowerCase());

  const scored = results
    .filter(r => {
      // 标题黑名单
      if (skip.some(k => r.title.toLowerCase().includes(k))) return false;
      // 艺人黑名单
      if (r.uploader && skipArtist.some(k => r.uploader.toLowerCase().includes(k))) return false;
      // 时长
      if (r.duration && (r.duration < durMin || r.duration > durMax)) return false;
      return true;
    })
    .map(r => {
      let score = 0;
      const rn = norm(r.title);
      if (nt && (nt.includes(rn) || rn.includes(nt))) score += 20;
      else if (nt && rn) score += Math.min(new Set(nt).size, 10);  // 字符交集
      for (const a of nArtists) {
        if (r.uploader && norm(r.uploader).includes(a)) { score += 10; break; }
      }
      if (deprioritize.some(k => r.title.toLowerCase().includes(k))) score -= 15;
      return { score, r };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.r ?? null;
}
```

### 其他方案
- **Rust**:逻辑相同,集合操作用 `HashSet`。
- **Go**:逐行对应。

### 重写难度:⭐⭐ 低(纯算法,已有现成实现可逐行搬)

---

## 功能 4:下载音频流 — `downloader.py:download_by_video_id` + `main.py` 批量

### 现状(Python)
```python
import yt_dlp
opts = {
  "format": "bestaudio[ext=webm]/bestaudio",
  "outtmpl": "{artist} - {title}.%(ext)s",
  "postprocessors": [
    {"key": "FFmpegVideoRemuxer", "preferedformat": "webm>opus"},  # 无损换容器
    {"key": "FFmpegMetadata"},      # 嵌元数据
    {"key": "EmbedThumbnail"},      # 嵌封面
  ],
}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info(url, download=True)
```

### 方案 B(TS)实现:同一个 yt-dlp,改当二进制子进程调

**yt-dlp 官方发布独立二进制**(Windows `yt-dlp.exe`、macOS/Linux 单文件),
不依赖 Python 解释器就能跑。命令行参数和 Python API 一一对应:

```bash
yt-dlp \
  -f "bestaudio[ext=webm]/bestaudio" \
  -o "%(artist)s - %(title)s.%(ext)s" \
  --remux-video "webm>opus" \         # 等价 FFmpegVideoRemuxer
  --embed-metadata \                  # 等价 FFmpegMetadata
  --embed-thumbnail \                 # 等价 EmbedThumbnail
  --newline \                         # 进度每行刷新,便于解析
  --progress-template "%(progress._percent_str)s" \
  "https://music.youtube.com/watch?v=XXX"
```

**Rust 薄壳封装(这是 Tauri 侧几乎唯一需要写的"真代码",~50 行):**
```rust
#[tauri::command]
async fn run_ytdlp(args: Vec<String>, on_progress: String, app: AppHandle) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(sidecar_path("yt-dlp"));
    cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    // 逐行读 progress,经 Tauri Event 推前端
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        app.emit(&on_progress, &line).ok();
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    Ok(if status.success() { "ok".into() } else { "failed".into() })
}
```

**前端收事件(等价 WebSocket,但走 IPC,无端口):**
```ts
listen('download-progress', (event) => {
  const line = event.payload as string;
  const m = line.match(/([\d.]+)%/);
  if (m) updateProgress(parseFloat(m[1]));   // 更新进度条
});
```

**并发批量**:TS 侧用 `p-limit` 控制并发数,等价现在 `ThreadPoolExecutor`。

### 其他方案
- 所有方案在这一步**都必须用 yt-dlp 二进制**(它是唯一可靠下载器)。区别只是"Python import"vs"子进程"。子进程方式更稳健:yt-dlp 崩了不会拖垮主进程。

### 重写难度:⭐⭐ 低(参数一一对应,Rust spawn 是模板代码)
**好处:子进程隔离,某首歌下载崩溃不影响 UI 主进程。**

---

## 功能 5:webm→opus 重封装 / opus→mp3 转码 — `opus2mp3.py`

### 现状(Python)
Python 只是 `subprocess.run(["ffmpeg", ...])` 调度器 + mutagen 拷标签。

### 方案 B:同样是 ffmpeg 二进制,换调度语言

**重封装(无损,换容器):**
```bash
ffmpeg -i input.webm -c copy output.opus   # -c copy = bit-for-bit
```

**转码 mp3(有损,320k CBR):**
```bash
ffmpeg -i input.opus -vn -c:a libmp3lame -b:a 320k output.mp3
```

Rust 侧 spawn(复用功能 4 的封装),并发用 `tokio` task。

**标签/封面拷贝**:用 Rust `lofty` crate 读写(见功能 6),不用 mutagen。

### 其他方案
- 所有方案都调 ffmpeg 二进制。Python 版本本来也只是 subprocess 调度,没有 Python 专有价值。

### 重写难度:⭐ 低

---

## 功能 6:音频元数据读写 — mutagen 的替代

### 现状(Python mutagen)
读 opus 的 Vorbis Comments、m4a 的 MP4 atoms、写 ID3v2.4。

### 方案 B:Rust `lofty` crate(功能等价,性能更好)
```rust
use lofty::probe::Probe;

let tagged_file = Probe::open_path(path)?.read()?;
if let Some(tag) = tagged_file.primary_tag() {
    let title = tag.get_string(&ItemKey::TrackTitle);
    let artist = tag.get_string(&ItemKey::TrackArtist);
    let album = tag.get_string(&ItemKey::AlbumTitle);
    let cover = tag.pictures().first();  // 原始字节
}
// 写:title/artist/album/cover 一样 set
```

`lofty` 支持 opus/m4a/mp3/flac/wav 全部常见格式,API 统一。

### 其他方案
- TS(Node 侧)有 `music-metadata`(读)和 `node-id3`(写 mp3),但 Tauri 后端是 Rust,直接用 lofty 更顺。
- Go 有 `dhowden/tag`。

### 重写难度:⭐⭐ 低(lofty API 比 mutagen 更统一)

---

## 功能 7:匹配校验 — `check_matches.py`(工具的"大脑")

这是工具最核心的算法价值,展开讲透。

### 7.1 标题相似度

**现状**:`difflib.SequenceMatcher.ratio()`,对"剥装饰后的标题"算。
**TS 实现**:`SequenceMatcher` 是经典算法,TS 有现成 `diff` 库或自写(80 行):
```ts
// 自写 SequenceMatcher(Python difflib 的移植,公版算法)
function sequenceMatcherRatio(a: string, b: string): number {
  // ... 完整实现 ~80 行,已有很多 TS 移植可参考
}
```
或用更快的 `js-levenshtein` 算归一化相似度。算法等价,结果一致。

### 7.2 艺人匹配(exact/partial/none)
纯字符串包含判断,TS 几行:
```ts
function artistMatch(req: string[], matched: string[]): ArtistState {
  if (!req.length) return 'no_requested';
  if (!matched.length) return 'no_matched';
  const nreq = req.map(norm), nmat = matched.map(norm);
  for (const ra of nreq) for (const ma of nmat)
    if (ra && ma && (ra.includes(ma) || ma.includes(ra))) return 'exact';
  for (const ra of nreq) for (const ma of nmat)
    if (ra && ma && [...ra].some(c => ma.includes(c))) return 'partial';
  return 'none';
}
```

### 7.3 Medley/串烧检测
正则,TS 原生:
```ts
const MEDLEY_RE = /(medley|mix\b|组曲|組曲|串烧|串燒|連環炮|连环炮)/i;
function looksLikeMedley(title: string): boolean {
  if (MEDLEY_RE.test(title)) return true;
  const bare = title.replace(/[\(（\[【].*?[\)）\]】]/g, '');
  return (bare.match(/\//g)?.length ?? 0) >= 2;
}
```

### 7.4 8 级分类
纯规则树,TS 逐分支对应:
```ts
function classify(sim: number, astat: ArtistState, reqTitle: string, matTitle: string): Class {
  if (astat === 'no_requested') return sim >= 0.7 ? 'ok_no_artist' : 'warn_title_only';
  if (astat === 'no_matched') return 'warn_no_artist';
  if (astat === 'exact') {
    if (sim >= 0.55) return 'ok';
    if (isSubstringMatch(reqTitle, matTitle) && !looksLikeMedley(matTitle)) return 'warn_alias_likely';
    return 'warn_title_diff';
  }
  if (astat === 'partial') return 'warn_partial_artist';
  // astat === 'none'
  if (sim >= 0.92) return 'warn_alias_likely';
  if (isSubstringMatch(reqTitle, matTitle) && !looksLikeMedley(matTitle)) return 'warn_alias_likely';
  return 'mismatch';
}
```

### 重写难度:⭐⭐ 低(规则清晰,已有现成 Python 实现逐行对照)
**好处:这套算法是工具真正的护城河,TS 移植后行为一致,且可单元测试保证不回归。**

---

## 功能 8:文件整理 / 改名 / 目录浏览 — `organize_by_check.py` / `rename_by_metadata.py`

### 现状:Python `shutil.move` + mutagen 读元数据。

### 方案 B:Tauri 文件系统 API
```ts
// 移动/改名:Tauri fs plugin
import { rename, moveFile } from '@tauri-apps/plugin-fs';
await moveFile(src, dst);

// 目录浏览:Tauri fs
import { readDir } from '@tauri-apps/plugin-fs';
const entries = await readDir('downloads');

// 元数据:Rust lofty(经 invoke)
```
改名前的"新旧名预览"在 TS 侧算,apply 时批量调 moveFile。

### 重写难度:⭐ 低(标准文件操作)

---

## 功能 9:来源识别(正版编录 vs 普通视频) — `list_non_catalog.py`

### 现状:读音频内嵌 `synopsis` 字段,匹配 `Provided to YouTube by` 签名。

### 方案 B
```ts
// Rust lofty 读 synopsis/description 字段
const synopsis = await invoke('read_tag_field', { path, field: 'synopsis' });
const isCatalog = synopsis.includes('Provided to YouTube by')
               || synopsis.includes('Auto-generated by YouTube');
const cls = !synopsis ? 'unreadable'
          : isCatalog ? (album ? 'catalog' : 'catalog_no_album')
          : 'non_catalog';
```
纯字符串包含判断 + lofty 读字段。

### 重写难度:⭐ 低

---

## 功能 10:Cookies 导出 — `export_cookies.py`

### 现状:`browser_cookie3` 读 Chrome/Firefox cookie 库(加密的)。

### 方案 B:Rust 直接读浏览器 SQLite + 系统密钥
- Chrome cookies 在 `~/Library/Application Support/Google/Chrome/Default/Cookies`(SQLite),
  加密用 macOS Keychain / Windows DPAPI / Linux Secret Service。
- Rust 有现成 `cookies-rs` / `browsercookie` crate 处理解密。
- 转 Netscape 格式后,传给 yt-dlp 的 `--cookies cookies.txt`。

```rust
// 概念示意(实际用现成 crate)
let cookies = browsercookie::chrome("youtube.com")?;  // 自动解密
write_netscape_format(&cookies, "cookies.txt")?;
```

**手动上传 cookies.txt** 最简单:用户自己用浏览器扩展导出,UI 读取文件即可,零加密处理。

### 重写难度:⭐⭐⭐ 中(加密解密有平台差异,但现成 crate 覆盖)

---

## 功能 11:繁简归一 — opencc

### 现状:`opencc-python-reimplemented`。

### 方案 B
- **TS**:`opencc-js`(npm 包,词典内置,纯 JS,WebView 里直接跑)。
- **Rust**:`opencc-rust` binding。

```ts
import * as OpenCC from 'opencc-js';
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
t2s('周杰倫');  // → '周杰伦'
```

### 重写难度:⭐ 低(有现成等价库)

---

## 功能 12:随机播放改名 — `shuffle_rename.py`

纯文件重命名 + 随机字符串生成(crypto.getRandomValues)。TS/Rust 都几十行。

### 重写难度:⭐ 极低

---

## 功能 13:find_duplicates.py

纯逻辑(比对两份歌单的归一化标题/艺人)。TS Set 操作。

### 重写难度:⭐ 极低

---

## 汇总:重写难度与"离不开 Python"程度

| 功能 | 行数 | 重写难度 | 离不开 Python? | 等价替代品 |
|------|------|----------|----------------|-----------|
| 歌单解析 | ~45 | ⭐ | ❌ | 纯算法 |
| **YT Music 搜索** | ~30 | ⭐⭐ | ⚠️ **唯一** | yt-dlp ytsearch(略逊)/ 可选插件 |
| 候选打分 | ~70 | ⭐⭐ | ❌ | 纯算法 |
| 下载音频 | — | ⭐ | ❌ | yt-dlp 二进制 |
| 转码 | ~60 | ⭐ | ❌ | ffmpeg 二进制 |
| 元数据读写 | — | ⭐⭐ | ❌ | Rust lofty |
| **匹配校验** | ~200 | ⭐⭐ | ❌ | 纯算法(核心价值,逐行移植) |
| 文件整理/改名 | ~150 | ⭐ | ❌ | Tauri fs |
| 来源识别 | ~60 | ⭐ | ❌ | lofty + 字符串 |
| Cookies 导出 | ~90 | ⭐⭐⭐ | ❌ | Rust browsercookie |
| 繁简 | — | ⭐ | ❌ | opencc-js |
| 随机改名 | ~120 | ⭐ | ❌ | 纯算法 |
| 去重 | ~150 | ⭐ | ❌ | 纯算法 |
| **总计** | ~1200 | — | **仅搜索 0.5 个** | — |

**核心结论:1200 行 Python 里,真正"离不开 Python"的只有 ytmusicapi 那一个搜索调用。
其余全是通用算法或独立二进制(yt-dlp/ffmpeg)的调度。重写到 TS 是机械工作,不损失能力。**

---

## 决策树

```
你在意"搜索精度始终最高"(ytmusicapi)?
├─ 是 → 选 B+:TS 主体 + 可选 Python 插件(默认纯,要精度 opt-in)
└─ 否,够用就行(靠分类兜底)
   ├─ 你或团队更熟 Go?
   │  └─ 选 D:Go + Tauri/Wails
   └─ 想要最快开发 + 最主流 Tauri 写法?
      └─ 选 B:TS 全栈 + Rust 薄壳(推荐)
```
