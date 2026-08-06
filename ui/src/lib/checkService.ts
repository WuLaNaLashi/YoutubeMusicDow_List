/**
 * 校验服务:读 success.json,给每条调用 checkMatches.classify 打分类,
 * 可选读磁盘元数据(readAudioMeta)做二次核对。
 *
 * 对应 Python `check_matches.py` 的 build_rows 逻辑。
 */
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { classify, artistMatch, type Class } from "./checkMatches";
import { titleSimilarity } from "./similarity";
import { readAudioMeta, type AudioMeta, type SourceClass } from "../api/tauri";

export interface CheckRow {
  raw: string;
  reqTitle: string;
  reqArtists: string[];
  matTitle: string;
  matArtists: string[];
  videoId: string | null;
  sim: number;
  cls: Class;
  filepath: string;
  exists: boolean;
  diskMeta: AudioMeta | null;
  source: SourceClass | null;
}

interface SuccessEntry {
  ok: boolean;
  song: { title: string; artists: string[] };
  match: { videoId: string; title: string; artists: string[] };
  download: { filepath: string };
}
type SuccessMap = Record<string, SuccessEntry>;

/** 读 success.json → 校验所有条目。checkFiles=true 时额外读磁盘元数据。 */
export async function buildCheckRows(
  projectRoot: string,
  checkFiles: boolean,
): Promise<CheckRow[]> {
  const successPath = await join(projectRoot, "logs", "success.json");
  if (!(await exists(successPath))) return [];

  const success = JSON.parse(await readTextFile(successPath)) as SuccessMap;
  const rows: CheckRow[] = [];

  for (const [raw, entry] of Object.entries(success)) {
    if (!entry.ok) continue;
    const reqTitle = entry.song.title ?? "";
    const reqArtists = entry.song.artists ?? [];
    const matTitle = entry.match.title ?? "";
    const matArtists = entry.match.artists ?? [];

    const sim = titleSimilarity(reqTitle, matTitle);
    const astat = artistMatch(reqArtists, matArtists);
    const cls = classify(sim, astat, reqTitle, matTitle);

    const filepath = entry.download.filepath ?? "";
    let fileExists = false;
    let diskMeta: AudioMeta | null = null;
    let source: SourceClass | null = null;
    if (checkFiles && filepath) {
      try {
        const r = await readAudioMeta(filepath);
        fileExists = r.meta !== null;
        diskMeta = r.meta;
        source = r.source;
      } catch {
        fileExists = false;
      }
    } else if (filepath) {
      fileExists = await exists(filepath);
    }

    rows.push({
      raw,
      reqTitle,
      reqArtists,
      matTitle,
      matArtists,
      videoId: entry.match.videoId ?? null,
      sim,
      cls,
      filepath,
      exists: fileExists,
      diskMeta,
      source,
    });
  }

  return rows;
}

/** 按分类统计计数。 */
export function countByClass(rows: CheckRow[]): Record<Class, number> {
  const counts: Record<Class, number> = {
    ok: 0,
    ok_no_artist: 0,
    warn_alias_likely: 0,
    warn_title_diff: 0,
    warn_partial_artist: 0,
    warn_no_artist: 0,
    warn_title_only: 0,
    mismatch: 0,
  };
  for (const r of rows) counts[r.cls]++;
  return counts;
}
