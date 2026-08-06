/**
 * 文件名清洗。移植自 `src/downloader.py:sanitize_filename`。
 */
const INVALID_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeFilename(s: string, maxLen = 180): string {
  let out = s.replace(INVALID_CHARS, "_");
  out = out.replace(/\s+/g, " ").trim().replace(/^[.]+|[.]+$/g, "");
  if (!out) out = "untitled";
  return out.slice(0, maxLen);
}
