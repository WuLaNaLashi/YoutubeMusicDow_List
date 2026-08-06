/**
 * 配置管理。
 *
 * 加载优先级:`config.user.json`(UI 写) > 默认值(从 src/config.py 移植)。
 *
 * UI 改的配置永远写 `config.user.json`,不碰源码 `config.py`。
 * CLI 启动也读 user.json,两边互不干扰。
 *
 * 注:在 Tauri 里用 plugin-fs 读写文件;在浏览器预览(无 Tauri)时降级到内存。
 */
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

/** 从 src/config.py 移植的默认值。 */
export const DEFAULT_CONFIG: AppConfig = {
  downloadsDir: "downloads",
  formatPreference: "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
  embedThumbnail: true,
  embedMetadata: true,
  concurrentDownloads: 3,
  retryTimes: 3,
  retryBackoff: [2, 8, 32],
  skipKeywords: [
    "karaoke", "伴奏", "off vocal", "off-vocal", "(mr)", " mr ", "mr版",
    "cover by", "翻唱", "翻唱版", "cover",
    "piano cover", "piano version", "piano ver.", "piano ver",
    "钢琴版", "鋼琴版", "钢琴cover", "钢琴 cover",
    "纯音乐", "純音樂", "纯钢琴", "純鋼琴",
    "instrumental", "纯伴奏", "純伴奏",
    "nightcore", "mmd", "8d audio", "sped up", "slowed",
    "配樂", "配乐", "演唱会", "演唱會",
  ],
  skipArtistKeywords: [
    "纯音乐", "純音樂", "配樂", "配乐", "karaoke", "instrumental",
    "music for u", "zzang karaoke",
  ],
  deprioritizeKeywords: [
    "live", "acoustic", "demo", "remix",
    "现场", "原声", "rehearsal", "reprise", "extended",
  ],
  deprioritizePenalty: 15,
  durationMinSec: 30,
  durationMaxSec: 1200,
  searchLimit: 5,
  proxy: "",
  cookiesFile: "cookies.txt",
  cookiesFromBrowser: "",
  /** 质量存疑处理策略(D-11):confirm | skip | auto */
  confirmPolicy: "confirm" as const,
  /** 测试随机种子 */
  testSeed: 42,
};

export interface AppConfig {
  downloadsDir: string;
  formatPreference: string;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  concurrentDownloads: number;
  retryTimes: number;
  retryBackoff: number[];
  skipKeywords: string[];
  skipArtistKeywords: string[];
  deprioritizeKeywords: string[];
  deprioritizePenalty: number;
  durationMinSec: number;
  durationMaxSec: number;
  searchLimit: number;
  proxy: string;
  cookiesFile: string;
  cookiesFromBrowser: string;
  confirmPolicy: "confirm" | "skip" | "auto";
  testSeed: number;
}

const CONFIG_FILENAME = "config.user.json";

/** 当前生效的配置(默认值 + user.json 覆盖)。 */
let currentConfig: AppConfig = { ...DEFAULT_CONFIG };

/** config.user.json 的绝对路径(项目根)。
 *
 * Tauri 应用进程 cwd 在 dev 时是项目根(因为 `pnpm tauri dev` 在项目根跑),
 * prod 时是 .app/Contents/Resources 同级。为兼容 CLI(也在项目根跑),
 * 用相对名 + cwd 定位,与现有 Python 脚本行为一致。
 */
async function configPath(): Promise<string> {
  return join(".", CONFIG_FILENAME);
}

/** 加载配置:user.json 覆盖默认。 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const p = await configPath();
    if (await exists(p)) {
      const text = await readTextFile(p);
      const user = JSON.parse(text) as Partial<AppConfig>;
      currentConfig = { ...DEFAULT_CONFIG, ...user };
    }
  } catch (e) {
    console.warn("加载 config.user.json 失败,用默认值:", e);
    currentConfig = { ...DEFAULT_CONFIG };
  }
  return currentConfig;
}

/** 保存配置到 user.json。 */
export async function saveConfig(cfg: AppConfig): Promise<void> {
  const p = await configPath();
  await writeTextFile(p, JSON.stringify(cfg, null, 2));
  currentConfig = { ...cfg };
}

/** 取当前配置(同步,加载后的快照)。 */
export function getConfig(): AppConfig {
  return currentConfig;
}
