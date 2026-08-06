/**
 * 设置页(S)。对应需求 §3.7。
 *
 * 首版聚焦最有用的三块:
 *   1. 网络:代理状态(显示探测到的系统代理)+ 手填覆盖 + 测试连通
 *   2. 路径:downloads/logs/songs_list 展示 + 打开
 *   3. 环境自检:yt-dlp/ffmpeg/deno/python 是否在 PATH
 *
 * Cookies 三来源管理、过滤词编辑器等留待后续(需求 S-C/S-D,优先级中)。
 */
import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Card, Tag, toast } from "../components/ui";
import { probeBinary, detectSystemProxy, resolveProxy, runCommand, onDone } from "../api/tauri";
import { getConfig, saveConfig } from "../lib/config";
import { useDownloadStore } from "../stores/downloadStore";

type Tab = "network" | "paths" | "env";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("env");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg-soft2 p-0.5 rounded-md w-fit">
        {([
          ["env", "✅ 环境自检"],
          ["network", "🌐 网络/代理"],
          ["paths", "📁 路径"],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-[13px] rounded-[6px] ${
              tab === t ? "bg-bg shadow-sm" : "text-text-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "env" && <EnvTab />}
      {tab === "network" && <NetworkTab />}
      {tab === "paths" && <PathsTab />}
    </div>
  );
}

interface Check {
  name: string;
  bin: string;
  minVersion?: string;
  result: { ok: boolean; path: string | null; note?: string };
}

function EnvTab() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);

  async function run() {
    setLoading(true);
    const items: Check[] = [];
    for (const [name, bin] of [
      ["yt-dlp", "yt-dlp"],
      ["ffmpeg", "ffmpeg"],
      ["deno", "deno"],
      ["python", "python3"],
    ] as const) {
      const path = await probeBinary(bin).catch(() => null);
      items.push({ name, bin, result: { ok: !!path, path } });
    }
    setChecks(items);
    setLoading(false);
  }

  useEffect(() => {
    run();
  }, []);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">环境自检</h3>
        <Button variant="ghost" onClick={run} disabled={loading}>{loading ? "检测中…" : "↻ 重新检测"}</Button>
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-bg-soft">
            <tr className="text-left text-text-2 text-xs">
              <th className="px-3 py-2">依赖</th>
              <th className="px-3 py-2">路径</th>
              <th className="px-3 py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.bin} className="border-b border-bg-soft2">
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-text-2 truncate max-w-[360px]" title={c.result.path ?? ""}>
                  {c.result.path ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {c.result.ok ? (
                    <Tag color="ok">✓ 在 PATH</Tag>
                  ) : (
                    <Tag color={c.bin === "python3" ? "warn" : "err"}>
                      {c.bin === "python3" ? "⚠ 未装(可选,仅高精度搜索插件用)" : "✗ 未找到"}
                    </Tag>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11.5px] text-text-3 mt-2">
        yt-dlp / ffmpeg / deno 是必需的;python3 可选(启用 B+ 高精度搜索插件时才需要)。
      </div>
    </Card>
  );
}

function NetworkTab() {
  const [systemProxy, setSystemProxy] = useState<string | null | undefined>(undefined);
  const [resolved, setResolved] = useState<string | null | undefined>(undefined);
  const [cfgProxy, setCfgProxy] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    detectSystemProxy().then(setSystemProxy).catch(() => setSystemProxy(null));
    resolveProxy().then(setResolved).catch(() => setResolved(null));
    setCfgProxy(getConfig().proxy);
  }, []);

  async function save() {
    await saveConfig({ ...getConfig(), proxy: cfgProxy });
    toast("已保存代理设置");
    const r = await resolveProxy().catch(() => null);
    setResolved(r);
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    const event = `conntest_${Math.random().toString(36).slice(2, 6)}`;
    let ok = false;
    const unlisten = await onDone(event, (e) => {
      ok = e.success;
    });
    try {
      await runCommand(
        "yt-dlp",
        ["--no-playlist", "--simulate", "--no-warnings", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
        { event, injectProxy: true },
      );
      // 等 done 事件(最多 12 秒)
      await new Promise((r) => setTimeout(r, 12000));
    } catch (e) {
      ok = false;
    } finally {
      unlisten();
    }
    setTesting(false);
    setTestResult(ok ? "✓ 可连通 YouTube" : "✗ 无法连通(检查代理/网络)");
  }

  return (
    <Card>
      <h3 className="text-[13px] font-semibold mb-3">网络 / 代理</h3>

      <div className="space-y-3">
        <div className="bg-bg-soft px-3 py-2 rounded-md text-[13px]">
          <div>系统代理探测:
            {systemProxy === undefined ? <span className="text-text-3"> 检测中…</span> :
             systemProxy === null ? <Tag color="neutral">未检测到</Tag> :
             <Tag color="ok">{systemProxy}</Tag>}
          </div>
          <div className="mt-1">当前生效代理:
            {resolved === undefined ? <span className="text-text-3"> 检测中…</span> :
             resolved === null ? <Tag color="warn">无(直连)</Tag> :
             <Tag color="ok">{resolved}</Tag>}
          </div>
          <div className="text-[11.5px] text-text-3 mt-1.5">
            优先级:UI 手填 &gt; 环境变量(HTTP_PROXY) &gt; 系统代理设置
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-2 mb-1 font-medium">代理(留空 = 自动探测系统代理)</label>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 border border-border-strong rounded-md text-[13px] font-mono"
              placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
              value={cfgProxy}
              onChange={(e) => setCfgProxy(e.target.value)}
            />
            <Button onClick={save}>💾 保存</Button>
          </div>
        </div>

        <div>
          <Button variant="primary" onClick={test} disabled={testing}>
            {testing ? "测试中…" : "🧪 测试连通 YouTube"}
          </Button>
          {testResult && (
            <span className={`ml-3 text-[13px] ${testResult.startsWith("✓") ? "text-ok" : "text-err"}`}>
              {testResult}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function PathsTab() {
  const rowsFromStore = useDownloadStore((s) => s.rows);
  const projectRoot = (() => {
    const fp = rowsFromStore[0]?.filepath;
    if (!fp) return ".";
    const idx = fp.lastIndexOf("/downloads/");
    return idx > 0 ? fp.slice(0, idx) : ".";
  })();

  const paths = [
    ["项目根", projectRoot],
    ["downloads", `${projectRoot}/downloads`],
    ["logs", `${projectRoot}/logs`],
    ["songs_list", `${projectRoot}/songs_list.txt`],
    ["success.json", `${projectRoot}/logs/success.json`],
    ["config.user.json", `${projectRoot}/config.user.json`],
  ];

  return (
    <Card>
      <h3 className="text-[13px] font-semibold mb-3">路径(只读)</h3>
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <tbody>
            {paths.map(([label, path]) => (
              <tr key={label} className="border-b border-bg-soft2">
                <td className="px-3 py-2 text-text-2 text-xs w-[130px]">{label}</td>
                <td className="px-3 py-2 font-mono text-xs">{path}</td>
                <td className="px-3 py-2">
                  <Button
                    className="!px-2 !py-0.5 !text-[12px]"
                    onClick={() => revealItemInDir(path).catch((e) => toast(`打开失败: ${e}`))}
                  >
                    打开
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11.5px] text-text-3 mt-2">
        配置改动写入 <code className="bg-bg-soft2 px-1 rounded">config.user.json</code>,覆盖 config.py 默认值,不污染源码。
      </div>
    </Card>
  );
}
