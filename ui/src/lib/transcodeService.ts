/**
 * 转码 & 改名工具服务。对应 Python `opus2mp3.py` + `shuffle_rename.py`。
 *
 * - transcodeOpusToMp3:opus→mp3(320k CBR),封面/标签由 ffmpeg 经 ID3 写入
 *   (yt-dlp 嵌的是 opus 的 Vorbis Comment,ffmpeg 转 mp3 时会自动迁移到 ID3)
 * - shuffleRename / restoreShuffle:给文件名加/去随机前缀(红米音箱伪随机播放)
 */
import { runCommand, onLine, onDone } from "../api/tauri";
import { scanAudioDir } from "../api/tauri";
import { basename, dirname, join } from "@tauri-apps/api/path";
import { moveFile } from "../api/tauri";

// ---- opus → mp3 转码 ----

export interface TranscodeItem {
  src: string;
  dst: string;
  state: "todo" | "transcoding" | "done" | "failed";
  failReason: string | null;
}

/** 扫描目录下 opus 文件,生成转码计划(输出到 {dir}/mp3/)。 */
export async function planTranscode(dir: string, recursive: boolean): Promise<TranscodeItem[]> {
  const all = await scanAudioDir(dir, recursive);
  const opusFiles = all.filter((a) => a.filename.toLowerCase().endsWith(".opus"));
  const used = new Set<string>();
  const items: TranscodeItem[] = [];
  for (const f of opusFiles) {
    let name = f.filename.replace(/\.opus$/i, ".mp3");
    if (used.has(name)) {
      const stem = f.filename.replace(/\.opus$/i, "");
      let n = 2;
      while (used.has(`${stem} (${n}).mp3`)) n++;
      name = `${stem} (${n}).mp3`;
    }
    used.add(name);
    items.push({
      src: f.path,
      dst: `${dir}/mp3/${name}`,
      state: "todo",
      failReason: null,
    });
  }
  return items;
}

/** 转码一个文件。 */
export async function transcodeOne(
  item: TranscodeItem,
  bitrate: string,
  onLog: (level: "info" | "warn" | "err" | "ok", msg: string) => void,
): Promise<{ ok: boolean; reason?: string }> {
  const event = `ffmpeg_${Math.random().toString(36).slice(2, 6)}`;
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", item.src,
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", bitrate,
    item.dst,
  ];
  const un = await onLine(event, (e) => {
    if (e.line.trim()) onLog(e.stream === "stderr" ? "warn" : "info", `  ffmpeg: ${e.line}`);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      onDone(event, (e) => {
        if (settled) return;
        settled = true;
        if (e.success) resolve();
        else reject(new Error(`ffmpeg 退出码 ${e.code ?? "?"}`));
      }).then(() => {
        runCommand("ffmpeg", args, { event }).catch((err) => {
          if (!settled) {
            settled = true;
            reject(new Error(`无法启动 ffmpeg: ${err}`));
          }
        });
      });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  } finally {
    un();
  }
}

// ---- 随机播放改名(shuffle_rename) ----

const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus"];

function randomPrefix(type: "number" | "letter" | "mixed", len: number): string {
  const chars =
    type === "number"
      ? "0123456789"
      : type === "letter"
        ? "abcdefghijklmnopqrstuvwxyz"
        : "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

export interface ShuffleItem {
  path: string;
  oldName: string;
  newName: string;
  state: "todo" | "done" | "failed";
}

/** 检测文件名是否已有随机前缀(形如 xxxx_ 名字)。 */
function hasPrefix(name: string, len: number): boolean {
  // 前缀 + 下划线
  return new RegExp(`^[a-z0-9]{${len}}_`, "i").test(name);
}

/** 生成加前缀计划。 */
export async function planShuffleRename(
  dir: string,
  recursive: boolean,
  prefixType: "number" | "letter" | "mixed",
  prefixLen: number,
): Promise<ShuffleItem[]> {
  const all = await scanAudioDir(dir, recursive);
  const items: ShuffleItem[] = [];
  for (const f of all) {
    if (!AUDIO_EXTS.some((e) => f.filename.toLowerCase().endsWith(e))) continue;
    if (hasPrefix(f.filename, prefixLen)) continue; // 已有前缀跳过
    const prefix = randomPrefix(prefixType, prefixLen);
    items.push({
      path: f.path,
      oldName: f.filename,
      newName: `${prefix}_${f.filename}`,
      state: "todo",
    });
  }
  return items;
}

/** 生成去前缀(还原)计划。 */
export async function planShuffleRestore(
  dir: string,
  recursive: boolean,
  prefixLen: number,
): Promise<ShuffleItem[]> {
  const all = await scanAudioDir(dir, recursive);
  const items: ShuffleItem[] = [];
  for (const f of all) {
    if (!AUDIO_EXTS.some((e) => f.filename.toLowerCase().endsWith(e))) continue;
    const m = f.filename.match(new RegExp(`^[a-z0-9]{${prefixLen}}_(.+)$`, "i"));
    if (!m) continue;
    items.push({
      path: f.path,
      oldName: f.filename,
      newName: m[1],
      state: "todo",
    });
  }
  return items;
}

/** 执行改名(加前缀/去前缀通用)。 */
export async function applyShuffle(items: ShuffleItem[]): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const it of items) {
    try {
      const dir = await dirname(it.path);
      const dst = await join(dir, it.newName);
      await moveFile(it.path, dst);
      it.state = "done";
      done++;
    } catch {
      it.state = "failed";
      failed++;
    }
  }
  return { done, failed };
}

export { basename };
