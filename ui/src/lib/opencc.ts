/**
 * 繁简归一化封装。
 *
 * opencc-js 在浏览器/WebView 里跑,首次 import 会加载词典(~2MB,打包进 bundle)。
 * 对应 Python 端 `opencc.OpenCC("t2s")`。
 */
import * as OpenCC from "opencc-js";

// 繁体 -> 简体 转换器(只创建一次)
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });

/** 繁体转简体。 */
export function toSimplified(s: string): string {
  if (!s) return "";
  return t2s(s);
}

/**
 * 归一化用于比对:繁→简、转小写、去掉所有非字母数字(含 CJK 标点与空格)。
 * 对应 Python `downloader._norm` / `parse_list._normalize`。
 */
export function normalize(s: string): string {
  if (!s) return "";
  return toSimplified(s)
    .toLowerCase()
    .replace(/[\s\W_]+/g, "");
}
