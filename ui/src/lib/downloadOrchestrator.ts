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
import { runCommand, cancelTask, onLine, onDone } from "../api/tauri";
import { sanitizeFilename } from "./sanitize";
import type { Row } from "../stores/downloadStore";

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
  if (cfg.proxy) {
    args.push("--proxy", cfg.proxy);
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
        runCommand("yt-dlp", [...args, url], { event }).catch((err) => {
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
  for (let i = 0; i < rows.length; i++) {
    if (isCancelled()) {
      cb.onLog("warn", "用户停止,已完成的不丢失");
      break;
    }
    const row = rows[i];
    if (row.state === "done" || row.state === "skipped") continue;
    const song = row.song;

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
      continue;
    }

    if (candidates.length === 0) {
      cb.onRowUpdate(i, { state: "failed", failReason: "无搜索结果" });
      cb.onLog("warn", "  无搜索结果");
      continue;
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
      continue;
    }

    const best = scored[0].result;

    // 3. 置信度
    const report = assessConfidence(best, song.title, song.artists, cfg.skipKeywords, cfg.deprioritizeKeywords);
    cb.onRowUpdate(i, { match: best, confidence: report.confidence, reason: report.reason, flags: report.flags });

    // 4. 策略判定
    const suspect = report.confidence !== "high";
    let toDownload: SearchResult | null = best;
    if (suspect) {
      if (cfg.confirmPolicy === "skip") {
        cb.onRowUpdate(i, { state: "skipped" });
        cb.onLog("warn", `  候选存疑(${report.confidence}),按策略跳过: ${report.reason}`);
        continue;
      } else if (cfg.confirmPolicy === "confirm") {
        cb.onRowUpdate(i, { state: "pending" });
        cb.onLog("warn", `  候选存疑(${report.confidence}),转入待确认: ${report.reason}`);
        const decision = await cb.onConfirmNeeded(i, best, scored.map((s) => s.result), report.reason ?? "");
        if (decision.action === "skip") {
          cb.onRowUpdate(i, { state: "skipped" });
          cb.onLog("info", `  用户跳过: ${song.title}`);
          continue;
        }
        toDownload = decision.pick ?? best;
        cb.onRowUpdate(i, { state: "searching", reason: null });
      }
      // auto 策略:存疑也直接下,事后 review
    }

    // 5. 下载
    cb.onRowUpdate(i, { state: "downloading", match: toDownload });
    cb.onLog("info", `  下载: ${toDownload!.title} (${toDownload!.uploader}) [${report.confidence}]`);
    try {
      const filepath = await downloadOne(toDownload!.id, song, cfg, downloadsDir, cb.onLog);
      cb.onRowUpdate(i, { state: "done", filepath });
      cb.onLog("ok", `  完成 → ${filepath}`);
    } catch (e) {
      cb.onRowUpdate(i, { state: "failed", failReason: `下载失败: ${e}` });
      cb.onLog("err", `  下载失败: ${e}`);
    }
  }
  cb.onAllDone();
}

export { cancelTask };
