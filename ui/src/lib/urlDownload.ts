/**
 * URL 直下。对应 Python `download_from_urls.py`。
 *
 * 跳过搜索/打分/置信度,直接用 yt-dlp 下指定的 URL。
 * 用 yt-dlp 的 extract_info 先拿标题/艺人决定文件名,再下载。
 */
import { runCommand, onLine, onDone, resolveProxy } from "../api/tauri";
import type { AppConfig } from "./config";
import { sanitizeFilename } from "./sanitize";

/** 从各种 YouTube URL 格式抽 11 位 videoId。 */
export function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:v=|\/v\/|\/embed\/|\/shorts\/|\/watch\?.*v=|youtu\.be\/|\/e\/|\/vi?\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

export interface UrlRow {
  url: string;
  videoId: string | null;
  state: "todo" | "downloading" | "done" | "failed";
  /** 实际拿到的标题/艺人(下完后) */
  title: string | null;
  artist: string | null;
  filepath: string | null;
  failReason: string | null;
}

/** 解析 URL 文本 → 去重后的列表。 */
export function parseUrlList(text: string): UrlRow[] {
  const seen = new Set<string>();
  const out: UrlRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const url = line.trim();
    if (!url || url.startsWith("#")) continue;
    const vid = extractVideoId(url);
    const key = vid ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, videoId: vid, state: "todo", title: null, artist: null, filepath: null, failReason: null });
  }
  return out;
}

/** 下载单个 URL。返回更新后的 row 信息。 */
export async function downloadUrl(
  row: UrlRow,
  cfg: AppConfig,
  downloadsDir: string,
  onLog: (level: "info" | "warn" | "err" | "ok", msg: string) => void,
): Promise<Partial<UrlRow>> {
  // 先探测标题(uploader)用于文件名
  const infoArgs = ["--dump-json", "--no-playlist"];
  let proxyUrl = cfg.proxy;
  if (!proxyUrl) {
    try {
      proxyUrl = (await resolveProxy()) ?? "";
    } catch {
      proxyUrl = "";
    }
  }
  if (proxyUrl) infoArgs.push("--proxy", proxyUrl);

  const infoEvent = `urlinfo_${Math.random().toString(36).slice(2, 8)}`;
  let infoJson = "";
  const unlistenInfo = await onLine(infoEvent, (e) => {
    if (e.stream === "stdout") infoJson += e.line + "\n";
  });

  let title = "untitled";
  let artist = "";
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      onDone(infoEvent, (e) => {
        if (settled) return;
        settled = true;
        if (e.success) resolve();
        else reject(new Error("获取视频信息失败"));
      }).then(() => {
        runCommand("yt-dlp", [...infoArgs, row.url], { event: infoEvent, injectProxy: true }).catch((err) => {
          if (!settled) {
            settled = true;
            reject(new Error(`无法启动 yt-dlp: ${err}`));
          }
        });
      });
    });
    unlistenInfo();
    const info = JSON.parse(infoJson.trim().split("\n")[0]);
    title = info.title ?? "untitled";
    artist = info.artist || info.uploader || "";
  } catch (e) {
    onLog("warn", `  获取标题失败(${e}),用 videoId 作文件名`);
  }

  const stem = sanitizeFilename(artist ? `${artist} - ${title}` : title || row.videoId || "untitled");
  const outTemplate = `${downloadsDir}/${stem}.%(ext)s`;

  const dlArgs = [
    "-f", cfg.formatPreference,
    "-o", outTemplate,
    "--remux-video", "webm>opus",
    "--newline",
    "--no-progress",
    "--no-playlist",
  ];
  if (cfg.embedMetadata) dlArgs.push("--embed-metadata");
  if (cfg.embedThumbnail) dlArgs.push("--embed-thumbnail");
  if (proxyUrl) dlArgs.push("--proxy", proxyUrl);
  if (cfg.cookiesFile) dlArgs.push("--cookies", cfg.cookiesFile);
  else if (cfg.cookiesFromBrowser) dlArgs.push("--cookies-from-browser", cfg.cookiesFromBrowser);

  const event = `urldl_${Math.random().toString(36).slice(2, 8)}`;
  const unlistenDl = await onLine(event, (e) => {
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
        runCommand("yt-dlp", [...dlArgs, row.url], { event, injectProxy: true }).catch((err) => {
          if (!settled) {
            settled = true;
            reject(new Error(`无法启动 yt-dlp: ${err}`));
          }
        });
      });
    });
    return {
      state: "done",
      title,
      artist,
      filepath: `${downloadsDir}/${stem}.opus`,
    };
  } catch (e) {
    return { state: "failed", failReason: `下载失败: ${e}`, title, artist };
  } finally {
    unlistenDl();
  }
}
