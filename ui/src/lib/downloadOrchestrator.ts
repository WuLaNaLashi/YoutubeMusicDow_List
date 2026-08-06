/**
 * 下载编排器。把"搜索 → pickBest → 置信度 → 策略判定 → 下载"串起来。
 *
 * 这是 D 页的"驱动逻辑",UI 只负责显示 store 状态和接收用户确认。
 *
 * 流程(每首歌):
 *   1. 搜索(yt-dlp ytsearch) → SearchResult[]
 *   2. scoreAll 打分 → 排序
 *   3. assessConfidence 评估最优候选置信度
 *   4. 按 confirmPolicy 处理:
 *      - high,或 auto 策略:直接下载
 *      - 存疑 + confirm:转 pending,等 UI 调 resolvePending
 *      - 存疑 + skip:转 skipped
 *   5. 下载(spawn yt-dlp 带格式/重封装/嵌元数据参数)
 */
import { searchSong } from "./search";
import { scoreAll } from "./pickBest";
import { assessConfidence } from "./confidence";
import type { AppConfig } from "./config";
import type { Song } from "./parseList";
import type { SearchResult } from "./pickBest";
import { runCommand, cancelTask, onLine, onDone, resolveProxy } from "../api/tauri";
import { sanitizeFilename } from "./sanitize";
import type { Row } from "../stores/downloadStore";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

// ---- success.json / failed.json 持久化(断点续传依据) ----
// 结构与原 Python 版兼容:{ [raw]: { ok, song, match, download } }
export interface SuccessEntry {
  ok: true;
  song: Song;
  match: { videoId: string; title: string; artists: string[] };
  download: { filepath: string };
}
type SuccessMap = Record<string, SuccessEntry>;
type FailedMap = Record<string, { ok: false; reason: string; song: Song }>;

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    if (await exists(path)) {
      return JSON.parse(await readTextFile(path)) as T;
    }
  } catch (e) {
    console.warn(`读取 ${path} 失败:`, e);
  }
  return fallback;
}

async function saveJson(path: string, data: unknown): Promise<void> {
  try {
    await writeTextFile(path, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn(`写入 ${path} 失败:`, e);
  }
}

export interface OrchestratorCallbacks {
  onRowUpdate: (idx: number, patch: Partial<Row>) => void;
  onLog: (level: "info" | "warn" | "err" | "ok", msg: string) => void;
  onAllDone: () => void;
  /** 需要用户确认时返回 Promise<boolean>(UI 弹层) */
  onConfirmNeeded: (
    idx: number,
    best: SearchResult,
    allCandidates: SearchResult[],
    reason: string,
  ) => Promise<{ action: "download" | "skip"; pick?: SearchResult }>;
}

/** yt-dlp 输出模板里的艺术家/标题占位。 */
function buildOutTemplate(downloadsDir: string, song: Song): string {
  const primary = song.artists[0] ?? "";
  const stem = sanitizeFilename(primary ? `${primary} - ${song.title}` : song.title);
  return `${downloadsDir}/${stem}.%(ext)s`;
}

/** 下载一首已确定的歌。返回文件路径或抛错。 */
async function downloadOne(
  videoId: string,
  song: Song,
  cfg: AppConfig,
  downloadsDir: string,
  onLog: OrchestratorCallbacks["onLog"],
): Promise<string> {
  const outTemplate = buildOutTemplate(downloadsDir, song);
  const url = `https://music.youtube.com/watch?v=${videoId}`;
  const args = [
    "-f", cfg.formatPreference,
    "-o", outTemplate,
    "--remux-video", "webm>opus",
    "--newline",
    "--no-progress",
  ];
  if (cfg.embedMetadata) args.push("--embed-metadata");
  if (cfg.embedThumbnail) args.push("--embed-thumbnail");

  // 代理:优先 config.proxy(用户显式填),否则探测系统代理(env > 系统设置)。
  // 显式 --proxy 最稳(覆盖 yt-dlp 所有请求);同时开 injectProxy 兜底环境变量。
  let proxyUrl = cfg.proxy;
  if (!proxyUrl) {
    try {
      proxyUrl = (await resolveProxy()) ?? "";
    } catch {
      proxyUrl = "";
    }
  }
  if (proxyUrl) {
    args.push("--proxy", proxyUrl);
    onLog("info", `  代理: ${proxyUrl}`);
  }

  if (cfg.cookiesFile) {
    args.push("--cookies", cfg.cookiesFile);
  } else if (cfg.cookiesFromBrowser) {
    args.push("--cookies-from-browser", cfg.cookiesFromBrowser);
  }

  const event = `dl_${videoId}_${Math.random().toString(36).slice(2, 6)}`;
  const unlisten = await onLine(event, (e) => {
    // 把 yt-dlp 的输出透传到日志(stderr 通常是警告/进度)
    if (e.line.trim()) onLog(e.stream === "stderr" ? "warn" : "info", `  yt-dlp: ${e.line}`);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      onDone(event, (e) => {
        if (settled) return;
        settled = true;
        if (e.success) resolve();
        else reject(new Error(`yt-dlp 退出码 ${e.code ?? "?"}`));
      }).then(() => {
        // injectProxy=true:即使 --proxy 没传,子进程也继承系统代理环境变量(兜底)
        runCommand("yt-dlp", [...args, url], { event, injectProxy: true }).catch((err) => {
          if (!settled) {
            settled = true;
            reject(new Error(`无法启动 yt-dlp: ${err}`));
          }
        });
      });
    });
    // 输出文件路径(opus 扩展名,因 --remux-video webm>opus)
    const primary = song.artists[0] ?? "";
    const stem = sanitizeFilename(primary ? `${primary} - ${song.title}` : song.title);
    return `${downloadsDir}/${stem}.opus`;
  } finally {
    unlisten();
  }
}

/**
 * 跑完整下载批次。串行(并发留待后续加 p-limit)。
 * isCancelled 在外部置 true 可中断。
 */
export async function runBatch(
  rows: Row[],
  cfg: AppConfig,
  downloadsDir: string,
  cb: OrchestratorCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  // 加载持久化记录(断点续传)
  const logsDir = await join(downloadsDir, "..", "logs").catch(() => "logs");
  const successPath = await join(logsDir, "success.json").catch(() => "logs/success.json");
  const failedPath = await join(logsDir, "failed.json").catch(() => "logs/failed.json");
  const success = await loadJson<SuccessMap>(successPath, {});
  const failed = await loadJson<FailedMap>(failedPath, {});
  let successDirty = false;
  let failedDirty = false;

  /** 处理单首歌(搜索→打分→置信度→策略→下载)。返回是否需要写盘。 */
  async function processOne(i: number): Promise<void> {
    if (isCancelled()) return;
    const row = rows[i];
    if (row.state === "done" || row.state === "skipped") return;
    const song = row.song;

    // 断点续传:success.json 里已成功的跳过
    if (success[song.raw]?.ok) {
      cb.onRowUpdate(i, {
        state: "done",
        filepath: success[song.raw].download.filepath,
        match: {
          id: success[song.raw].match.videoId,
          title: success[song.raw].match.title,
          uploader: success[song.raw].match.artists.join("/"),
        } as SearchResult,
      });
      return;
    }

    // 1. 搜索
    cb.onRowUpdate(i, { state: "searching", match: null, confidence: null, reason: null, flags: [] });
    cb.onLog("info", `[${i + 1}/${rows.length}] ${song.title} - ${song.artists.join("/")}: 搜索中…`);

    let candidates: SearchResult[];
    try {
      candidates = await searchSong([song.title, ...song.artists].join(" "), {
        limit: cfg.searchLimit,
      });
    } catch (e) {
      cb.onRowUpdate(i, { state: "failed", failReason: `搜索失败: ${e}` });
      cb.onLog("err", `  搜索失败: ${e}`);
      failed[song.raw] = { ok: false, reason: `搜索失败: ${e}`, song };
      failedDirty = true;
      return;
    }

    if (candidates.length === 0) {
      cb.onRowUpdate(i, { state: "failed", failReason: "无搜索结果" });
      cb.onLog("warn", "  无搜索结果");
      failed[song.raw] = { ok: false, reason: "无搜索结果", song };
      failedDirty = true;
      return;
    }

    // 2. 打分
    const scored = scoreAll(candidates, song.title, song.artists, {
      skipKeywords: cfg.skipKeywords,
      skipArtistKeywords: cfg.skipArtistKeywords,
      deprioritizeKeywords: cfg.deprioritizeKeywords,
      deprioritizePenalty: cfg.deprioritizePenalty,
      durationMinSec: cfg.durationMinSec,
      durationMaxSec: cfg.durationMaxSec,
    });

    if (scored.length === 0) {
      cb.onRowUpdate(i, { state: "failed", failReason: "候选全被黑名单/时长过滤" });
      cb.onLog("warn", "  候选全被过滤");
      failed[song.raw] = { ok: false, reason: "候选全被过滤", song };
      failedDirty = true;
      return;
    }

    const best = scored[0].result;

    // 3. 置信度
    const report = assessConfidence(best, song.title, song.artists, cfg.skipKeywords, cfg.deprioritizeKeywords);
    cb.onRowUpdate(i, { match: best, confidence: report.confidence, reason: report.reason, flags: report.flags });

    // 4. 策略判定
    const suspect = report.confidence !== "high";
    let toDownload: SearchResult = best;
    if (suspect) {
      if (cfg.confirmPolicy === "skip") {
        cb.onRowUpdate(i, { state: "skipped" });
        cb.onLog("warn", `  候选存疑(${report.confidence}),按策略跳过: ${report.reason}`);
        return;
      } else if (cfg.confirmPolicy === "confirm") {
        cb.onRowUpdate(i, { state: "pending" });
        cb.onLog("warn", `  候选存疑(${report.confidence}),转入待确认: ${report.reason}`);
        const decision = await cb.onConfirmNeeded(i, best, scored.map((s) => s.result), report.reason ?? "");
        if (isCancelled()) return;
        if (decision.action === "skip") {
          cb.onRowUpdate(i, { state: "skipped" });
          cb.onLog("info", `  用户跳过: ${song.title}`);
          return;
        }
        toDownload = decision.pick ?? best;
        cb.onRowUpdate(i, { state: "searching", reason: null });
      }
      // auto 策略:存疑也直接下,事后 review
    }

    // 5. 下载
    cb.onRowUpdate(i, { state: "downloading", match: toDownload });
    cb.onLog("info", `  下载: ${toDownload.title} (${toDownload.uploader}) [${report.confidence}]`);
    try {
      const filepath = await downloadOne(toDownload.id, song, cfg, downloadsDir, cb.onLog);
      cb.onRowUpdate(i, { state: "done", filepath });
      cb.onLog("ok", `  完成 → ${filepath}`);
      success[song.raw] = {
        ok: true,
        song,
        match: {
          videoId: toDownload.id,
          title: toDownload.title,
          artists: toDownload.uploader ? [toDownload.uploader] : [],
        },
        download: { filepath },
      };
      successDirty = true;
    } catch (e) {
      cb.onRowUpdate(i, { state: "failed", failReason: `下载失败: ${e}` });
      cb.onLog("err", `  下载失败: ${e}`);
      failed[song.raw] = { ok: false, reason: `下载失败: ${e}`, song };
      failedDirty = true;
    }
  }

  // 并发池:cfg.confirmPolicy === "confirm" 时,存疑确认会阻塞单条但不阻塞其他;
  // 为避免多条同时弹确认层,confirm 策略下并发降为 1(串行,逐条确认)。
  const concurrency = cfg.confirmPolicy === "confirm" ? 1 : Math.max(1, cfg.concurrentDownloads);
  cb.onLog("info", `并发数: ${concurrency}${cfg.confirmPolicy === "confirm" ? "(确认模式串行)" : ""}`);

  const indices = rows.map((_, i) => i);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      if (isCancelled()) return;
      const i = nextIdx++;
      if (i >= indices.length) return;
      await processOne(i);
      // 每完成一首落盘(弹性,中断不丢)
      if (successDirty) {
        await saveJson(successPath, success);
        successDirty = false;
      }
      if (failedDirty) {
        await saveJson(failedPath, failed);
        failedDirty = false;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, indices.length) }, () => worker()));

  if (isCancelled()) cb.onLog("warn", "用户停止,已完成的不丢失");
  cb.onAllDone();
}

export { cancelTask };
