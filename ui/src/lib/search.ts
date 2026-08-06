/**
 * YT 搜索。两种来源:
 *   - 默认:`yt-dlp "ytsearch{N}:{query}" --flat-playlist --dump-json`
 *   - 可选(B+ 高精度):ytmusicapi Python 插件(后续阶段加)
 *
 * 默认方案用 yt-dlp 自带搜索,返回 N 条 JSON,解析成 SearchResult[]。
 * 注:yt-dlp ytsearch 没有 ytmusicapi 的 filter="songs" 精准,但够用,
 * 靠 pickBest 打分 + confidence 置信度兜底(见 confidence.ts)。
 */
import { runCommand, onLine, onDone, resolveProxy } from "../api/tauri";
import type { SearchResult } from "./pickBest";

/** yt-dlp --dump-json 单行输出的结构(只取关心的字段)。 */
interface YtDlpFlatEntry {
  id: string;
  title: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  view_count?: number;
  url?: string;
  webpage_url?: string;
}

/** 把 yt-dlp dump-json 一行解析成 SearchResult。 */
function parseEntry(raw: string): SearchResult | null {
  try {
    const e = JSON.parse(raw) as YtDlpFlatEntry;
    return {
      id: e.id,
      title: e.title,
      uploader: e.uploader || e.channel || "",
      duration: typeof e.duration === "number" ? e.duration : undefined,
      viewCount: e.view_count,
      resultType: "video", // yt-dlp ytsearch 不区分;后续 ytmusicapi 插件会给 "song"
    };
  } catch {
    return null;
  }
}

export interface SearchProgress {
  /** 已收到的候选数 */
  collected: number;
  /** 解析出的候选(增量推送) */
  candidates: SearchResult[];
}

export interface SearchOptions {
  /** 候选数,默认 5 */
  limit?: number;
  /** 进度回调(每收到一行调用) */
  onProgress?: (p: SearchProgress) => void;
  /** 事件名前缀(避免多任务冲突),默认 "search" */
  event?: string;
}

/**
 * 搜索一首歌。返回所有候选。
 *
 * 用 yt-dlp 的 ytsearch 引擎:`yt-dlp "ytsearch5:{query}" --flat-playlist --dump-json`
 * 每行一个 JSON,逐行解析。
 */
export async function searchSong(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const limit = opts.limit ?? 5;
  const event = opts.event ?? `search_${Math.random().toString(36).slice(2, 8)}`;

  const candidates: SearchResult[] = [];
  const unlistenLine = await onLine(event, (e) => {
    if (e.stream !== "stdout") return;
    const parsed = parseEntry(e.line);
    if (parsed) {
      candidates.push(parsed);
      opts.onProgress?.({ collected: candidates.length, candidates: [...candidates] });
    }
  });

  try {
    // 探测代理:config 没显式传的话,这里用 resolveProxy(env > 系统设置)
    let proxyUrl: string | null = null;
    try {
      proxyUrl = await resolveProxy();
    } catch {
      proxyUrl = null;
    }
    const searchArgs = [`ytsearch${limit}:${query}`, "--flat-playlist", "--dump-json"];
    if (proxyUrl) searchArgs.push("--proxy", proxyUrl);

    await new Promise<void>((resolve, reject) => {
      let taskDone = false;
      onDone(event, (e) => {
        if (taskDone) return;
        taskDone = true;
        if (e.success || candidates.length > 0) resolve();
        else reject(new Error("yt-dlp 搜索失败(exit 非 0 且无结果)"));
      }).then((un) => {
        // done 监听器立即装好;若命令已结束也会补触发
        // injectProxy=true 兜底:即使 --proxy 没传,环境变量也带上系统代理
        runCommand("yt-dlp", searchArgs, { event, injectProxy: true })
          .catch((err) => {
            if (!taskDone) {
              taskDone = true;
              un();
              reject(new Error(`无法启动 yt-dlp: ${err}`));
            }
          });
      });
    });
    return candidates;
  } finally {
    unlistenLine();
  }
}
