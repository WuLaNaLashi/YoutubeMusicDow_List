/**
 * 繁简归一化封装。
 *
 * opencc-js 的 Converter 创建时会加载词典(~2MB)。
 * 为避免拖慢首屏,这里**懒加载 + 缓存**:首次调用 toSimplified/normalize 时才创建,
 * 之后复用。Converter 创建在主线程仍有一次性的 ~50ms 开销,但只发生一次,
 * 且发生在第一次下载/校验时(那时用户预期会有处理延迟),不影响日常交互。
 *
 * 对应 Python 端 `opencc.OpenCC("t2s")`。
 */
import * as OpenCC from "opencc-js";

let converter: ((s: string) => string) | null = null;
let converterPromise: Promise<(s: string) => string> | null = null;

/** 获取(或创建)t2s 转换器。并发安全:同时多次调用只创建一次。 */
function getConverter(): Promise<(s: string) => string> {
  if (converter) return Promise.resolve(converter);
  if (converterPromise) return converterPromise;
  converterPromise = new Promise((resolve) => {
    // 创建 Converter(此时加载词典);用 setTimeout 让出主线程一帧,避免卡顿
    setTimeout(() => {
      converter = OpenCC.Converter({ from: "tw", to: "cn" });
      converterPromise = null;
      resolve(converter);
    }, 0);
  });
  return converterPromise;
}

/** 异步版繁→简。首次调用会触发词典加载。 */
export async function toSimplifiedAsync(s: string): Promise<string> {
  if (!s) return "";
  const conv = await getConverter();
  return conv(s);
}

/**
 * 异步版归一化:繁→简、转小写、去非字母数字。
 * 对应 Python `downloader._norm`。下载/校验等异步路径用这个。
 */
export async function normalizeAsync(s: string): Promise<string> {
  if (!s) return "";
  const conv = await getConverter();
  return conv(s)
    .toLowerCase()
    .replace(/[\s\W_]+/g, "");
}

/**
 * 同步版繁→简。若 Converter 未就绪,**跳过繁简转换**(只做后续清理),
 * 立即返回。适用于 UI 渲染路径里"宁可不够准也不要卡"的场景。
 * 真正需要准确归一化的异步路径应改用 normalizeAsync。
 */
export function toSimplified(s: string): string {
  if (!s) return "";
  return converter ? converter(s) : s;
}

/**
 * 同步版归一化。Converter 未就绪时跳过繁简(降级,不阻塞)。
 */
export function normalize(s: string): string {
  if (!s) return "";
  return toSimplified(s)
    .toLowerCase()
    .replace(/[\s\W_]+/g, "");
}
