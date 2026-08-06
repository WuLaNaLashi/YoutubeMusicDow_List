/**
 * 文件整理服务。对应 Python `organize_by_check.py` + `rename_by_metadata.py`。
 *
 * 两种操作:
 *   1. 按分类挪文件:success.json + classify → downloads/{cls}/
 *   2. 按内嵌元数据改名:{真实艺人} - {真实标题}.{ext}
 *
 * 都支持 dry-run(只算计划)/ apply(实际执行)。
 */
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { join, dirname, basename } from "@tauri-apps/api/path";
import { classify, artistMatch, type Class } from "./checkMatches";
import { titleSimilarity } from "./similarity";
import { sanitizeFilename } from "./sanitize";
import {
  moveFile,
  readAudioMeta,
  pathExists,
  joinPath,
} from "../api/tauri";

interface SuccessEntry {
  ok: boolean;
  song: { title: string; artists: string[] };
  match: { videoId: string; title: string; artists: string[] };
  download: { filepath: string };
}
type SuccessMap = Record<string, SuccessEntry>;

async function loadSuccess(projectRoot: string): Promise<SuccessMap> {
  const p = await join(projectRoot, "logs", "success.json");
  if (!(await exists(p))) return {};
  return JSON.parse(await readTextFile(p)) as SuccessMap;
}

// ---- 按分类挪文件 ----

export interface MovePlanItem {
  raw: string;
  cls: Class;
  src: string;
  dst: string;
  /** 已在正确位置(无需挪) */
  alreadyCorrect: boolean;
  /** 源文件找不到 */
  missing: boolean;
}
export interface MovePlan {
  items: MovePlanItem[];
  byCls: Record<string, number>;
  missingCount: number;
  alreadyCorrectCount: number;
}

/** 计算按分类挪文件的计划(不执行)。 */
export async function planMoveByClass(
  projectRoot: string,
  downloadsDir: string,
): Promise<MovePlan> {
  const success = await loadSuccess(projectRoot);
  const items: MovePlanItem[] = [];
  const byCls: Record<string, number> = {};
  let missingCount = 0;
  let alreadyCorrectCount = 0;

  for (const [raw, entry] of Object.entries(success)) {
    if (!entry.ok) continue;
    const reqTitle = entry.song.title ?? "";
    const reqArtists = entry.song.artists ?? [];
    const matTitle = entry.match.title ?? "";
    const matArtists = entry.match.artists ?? [];
    const sim = titleSimilarity(reqTitle, matTitle);
    const astat = artistMatch(reqArtists, matArtists);
    const cls = classify(sim, astat, reqTitle, matTitle);

    const src = entry.download.filepath ?? "";
    // 文件可能已被挪进子目录,先按原路径找,找不到就在 downloadsDir 下递归找
    let actualSrc = src;
    if (src && !(await exists(src))) {
      const name = await basename(src);
      // 在 downloadsDir 各子目录找
      const candidate = await joinPath(downloadsDir, name);
      if (await pathExists(candidate)) {
        actualSrc = candidate;
      } else {
        // 找子目录
        for (const sub of [cls, "ok", "mismatch"]) {
          const c = await joinPath(await joinPath(downloadsDir, sub), name);
          if (await pathExists(c)) {
            actualSrc = c;
            break;
          }
        }
      }
    }

    const name = await basename(actualSrc);
    const dst = await joinPath(await joinPath(downloadsDir, cls), name);

    const srcExists: boolean = !!actualSrc && (await exists(actualSrc));
    // 判断"已在正确位置":src 的父目录就是 {cls}
    const srcDir = await dirname(actualSrc);
    const targetDir = await joinPath(downloadsDir, cls);
    const alreadyCorrect = srcExists && srcDir === targetDir;

    items.push({ raw, cls, src: actualSrc, dst, alreadyCorrect, missing: !srcExists });
    if (!srcExists) missingCount++;
    else if (alreadyCorrect) alreadyCorrectCount++;
    else byCls[cls] = (byCls[cls] ?? 0) + 1;
  }

  return { items, byCls, missingCount, alreadyCorrectCount };
}

/** 执行按分类挪文件(只挪 missing=false 且 alreadyCorrect=false 的)。返回 {moved, failed}。 */
export async function applyMoveByClass(
  plan: MovePlan,
  copy: boolean,
): Promise<{ moved: number; failed: number; errors: string[] }> {
  let moved = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of plan.items) {
    if (item.missing || item.alreadyCorrect) continue;
    try {
      if (copy) {
        await moveFile(item.src, item.dst).catch(async () => {
          // moveFile 失败尝试 copy(跨卷)
          const { copyFile } = await import("../api/tauri");
          await copyFile(item.src, item.dst);
        });
      } else {
        await moveFile(item.src, item.dst);
      }
      moved++;
    } catch (e) {
      failed++;
      errors.push(`${item.raw}: ${e}`);
    }
  }
  return { moved, failed, errors };
}

// ---- 按内嵌元数据改名 ----

export interface RenamePlanItem {
  path: string;
  oldName: string;
  newName: string;
  artist: string;
  title: string;
  /** 新旧名一致 */
  unchanged: boolean;
  /** 读不出元数据 */
  unreadable: boolean;
}
export interface RenamePlan {
  items: RenamePlanItem[];
  unchangedCount: number;
  unreadableCount: number;
  toRenameCount: number;
}

/**
 * 计算按元数据改名的计划。
 * @param targetDir 要扫的目录(通常 downloads/)
 * @param classes 只改这些分类的(通过 success.json + classify 反查);传 null 则改目录下所有
 */
export async function planRenameByMetadata(
  projectRoot: string,
  downloadsDir: string,
  classes: Set<Class> | null,
): Promise<RenamePlan> {
  // 先建 success.json 的"文件路径 → 分类"映射(若指定了 classes)
  const success = await loadSuccess(projectRoot);
  const pathToCls = new Map<string, Class>();
  if (classes) {
    for (const entry of Object.values(success)) {
      if (!entry.ok) continue;
      const sim = titleSimilarity(entry.song.title, entry.match.title);
      const astat = artistMatch(entry.song.artists, entry.match.artists);
      const cls = classify(sim, astat, entry.song.title, entry.match.title);
      pathToCls.set(entry.download.filepath, cls);
    }
  }

  const { scanAudioDir } = await import("../api/tauri");
  const audioFiles = await scanAudioDir(downloadsDir, true);

  const items: RenamePlanItem[] = [];
  let unchangedCount = 0;
  let unreadableCount = 0;
  let toRenameCount = 0;

  for (const af of audioFiles) {
    // 分类过滤
    if (classes) {
      const cls = pathToCls.get(af.path);
      if (!cls || !classes.has(cls)) continue;
    }
    const meta = await readAudioMeta(af.path);
    if (!meta.meta) {
      items.push({
        path: af.path,
        oldName: af.filename,
        newName: af.filename,
        artist: "",
        title: "",
        unchanged: false,
        unreadable: true,
      });
      unreadableCount++;
      continue;
    }
    const artist = meta.meta.artist ?? "";
    const title = meta.meta.title ?? "";
    const ext = af.filename.includes(".") ? af.filename.slice(af.filename.lastIndexOf(".")) : "";
    const stem = sanitizeFilename(
      artist && title ? `${artist} - ${title}` : title || artist || "untitled",
    );
    const newName = `${stem}${ext}`;
    if (newName === af.filename) {
      items.push({
        path: af.path,
        oldName: af.filename,
        newName,
        artist,
        title,
        unchanged: true,
        unreadable: false,
      });
      unchangedCount++;
    } else {
      items.push({
        path: af.path,
        oldName: af.filename,
        newName,
        artist,
        title,
        unchanged: false,
        unreadable: false,
      });
      toRenameCount++;
    }
  }

  return { items, unchangedCount, unreadableCount, toRenameCount };
}

/** 执行改名。冲突的目标名加 (2)/(3) 后缀。 */
export async function applyRename(
  plan: RenamePlan,
): Promise<{ renamed: number; failed: number; errors: string[] }> {
  let renamed = 0;
  let failed = 0;
  const errors: string[] = [];
  const usedNames = new Set<string>();

  for (const item of plan.items) {
    if (item.unchanged || item.unreadable) continue;
    let target = item.newName;
    // 冲突处理:加后缀
    const dir = await dirname(item.path);
    let n = 2;
    while (usedNames.has(await joinPath(dir, target)) || (await pathExists(await joinPath(dir, target)))) {
      const ext = target.includes(".") ? target.slice(target.lastIndexOf(".")) : "";
      const stem = target.slice(0, target.length - ext.length);
      target = `${stem} (${n})${ext}`;
      n++;
    }
    usedNames.add(await joinPath(dir, target));
    try {
      const { renameFile } = await import("../api/tauri");
      await renameFile(item.path, target);
      renamed++;
    } catch (e) {
      failed++;
      errors.push(`${item.oldName}: ${e}`);
    }
  }
  return { renamed, failed, errors };
}
