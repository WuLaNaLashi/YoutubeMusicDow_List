/**
 * 工具页(T)。对应需求 §3.6 T-1/T-2。
 *
 * 两个子工具(切换 tab):
 *   1. opus → mp3 转码(ffmpeg,320k CBR,输出进 {dir}/mp3/)
 *   2. 随机播放改名(红米音箱伪随机,加/去前缀)
 */
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Card, Tag, toast } from "../components/ui";
import {
  planTranscode,
  transcodeOne,
  planShuffleRename,
  planShuffleRestore,
  applyShuffle,
  type TranscodeItem,
  type ShuffleItem,
} from "../lib/transcodeService";
import { useDownloadStore } from "../stores/downloadStore";

type Mode = "transcode" | "shuffle";

export default function ToolsPage() {
  const [mode, setMode] = useState<Mode>("transcode");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg-soft2 p-0.5 rounded-md w-fit">
        {([
          ["transcode", "🎵 opus → mp3"],
          ["shuffle", "🔀 随机播放改名"],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-[13px] rounded-[6px] ${
              mode === m ? "bg-bg shadow-sm" : "text-text-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "transcode" ? <TranscodeMode /> : <ShuffleMode />}
    </div>
  );
}

function TranscodeMode() {
  const [dir, setDir] = useState("downloads");
  const [recursive, setRecursive] = useState(true);
  const [bitrate, setBitrate] = useState("320k");
  const [items, setItems] = useState<TranscodeItem[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const log = useDownloadStore((s) => s.log);

  async function pick() {
    const d = await open({ directory: true });
    if (typeof d === "string") setDir(d);
  }

  async function preview() {
    try {
      const p = await planTranscode(dir, recursive);
      setItems(p);
      setDone(0);
      toast(`找到 ${p.length} 个 opus 文件`);
    } catch (e) {
      toast(`预览失败: ${e}`);
    }
  }

  async function run() {
    if (items.length === 0) return;
    setRunning(true);
    log("info", `转码开始:${items.length} 个,${bitrate}`);
    let cnt = 0;
    for (let i = 0; i < items.length; i++) {
      setItems((prev) => prev.map((x, k) => (k === i ? { ...x, state: "transcoding" } : x)));
      const r = await transcodeOne(items[i], bitrate, log);
      cnt++;
      setDone(cnt);
      setItems((prev) =>
        prev.map((x, k) =>
          k === i
            ? { ...x, state: r.ok ? "done" : "failed", failReason: r.reason ?? null }
            : x,
        ),
      );
      log(r.ok ? "ok" : "err", `  [${cnt}/${items.length}] ${items[i].src.split(/[\\/]/).pop()} ${r.ok ? "完成" : r.reason}`);
    }
    setRunning(false);
    log("ok", "转码结束");
    toast(`完成 ${cnt} 个`);
  }

  return (
    <Card>
      <h3 className="text-[13px] font-semibold mb-3">opus → mp3 转码</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs text-text-2 mb-1 font-medium">目录</label>
          <div className="flex gap-1">
            <input className="flex-1 px-2 py-1.5 border border-border-strong rounded text-[12.5px] font-mono" value={dir} onChange={(e) => setDir(e.target.value)} />
            <Button onClick={pick}>…</Button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-2 mb-1 font-medium">码率</label>
          <select className="w-full px-2 py-1.5 border border-border-strong rounded text-[13px]" value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
            <option value="320k">320k (CBR, 推荐)</option>
            <option value="256k">256k</option>
            <option value="192k">192k</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} className="accent-brand" />
            递归子目录
          </label>
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <Button onClick={preview} disabled={running}>👁️ 预览</Button>
        <Button variant="primary" onClick={run} disabled={running || items.length === 0}>
          {running ? `转码中 ${done}/${items.length}` : `✓ 执行(${items.length})`}
        </Button>
      </div>
      {items.length > 0 && (
        <div className="border border-border rounded-md overflow-auto max-h-[360px]">
          <table className="w-full text-[12.5px]">
            <thead className="bg-bg-soft sticky top-0">
              <tr className="text-left text-text-2 text-xs">
                <th className="px-2 py-1.5">源文件</th>
                <th className="px-2 py-1.5">→ mp3/</th>
                <th className="px-2 py-1.5">状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-bg-soft2">
                  <td className="px-2 py-1.5 truncate max-w-[180px]" title={it.src}>{it.src.split(/[\\/]/).pop()}</td>
                  <td className="px-2 py-1.5 text-text-2 truncate max-w-[180px]">{it.dst.split(/[\\/]/).pop()}</td>
                  <td className="px-2 py-1.5">
                    {it.state === "done" && <Tag color="ok">✓</Tag>}
                    {it.state === "transcoding" && <Tag color="info"><span className="spinner" /></Tag>}
                    {it.state === "failed" && <Tag color="err">✗</Tag>}
                    {it.state === "todo" && <Tag color="neutral">待</Tag>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[11.5px] text-text-3 mt-2">⚠ opus→mp3 是有损→有损,会有音质损失,仅在设备不支持 opus 时用。输出进 {dir}/mp3/。</div>
    </Card>
  );
}

function ShuffleMode() {
  const [dir, setDir] = useState("downloads");
  const [recursive, setRecursive] = useState(true);
  const [prefixType, setPrefixType] = useState<"number" | "letter" | "mixed">("mixed");
  const [prefixLen, setPrefixLen] = useState(4);
  const [items, setItems] = useState<ShuffleItem[]>([]);
  const [running, setRunning] = useState(false);

  async function pick() {
    const d = await open({ directory: true });
    if (typeof d === "string") setDir(d);
  }
  async function preview(add: boolean) {
    try {
      const p = add
        ? await planShuffleRename(dir, recursive, prefixType, prefixLen)
        : await planShuffleRestore(dir, recursive, prefixLen);
      setItems(p);
      toast(`${add ? "加前缀" : "还原"}: ${p.length} 个文件`);
    } catch (e) {
      toast(`预览失败: ${e}`);
    }
  }
  async function run() {
    if (items.length === 0) return;
    setRunning(true);
    const r = await applyShuffle(items);
    setRunning(false);
    toast(`完成 ${r.done},失败 ${r.failed}`);
    setItems([]);
  }

  return (
    <Card>
      <h3 className="text-[13px] font-semibold mb-1">随机播放改名(红米音箱)</h3>
      <div className="text-text-3 text-xs mb-3">给文件名加随机前缀(如 a3b7_),让音箱按文件名排序实现"伪随机"播放</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="block text-xs text-text-2 mb-1 font-medium">目录</label>
          <div className="flex gap-1">
            <input className="flex-1 px-2 py-1.5 border border-border-strong rounded text-[12.5px] font-mono" value={dir} onChange={(e) => setDir(e.target.value)} />
            <Button onClick={pick}>…</Button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-2 mb-1 font-medium">前缀类型</label>
          <select className="w-full px-2 py-1.5 border border-border-strong rounded text-[13px]" value={prefixType} onChange={(e) => setPrefixType(e.target.value as "number" | "letter" | "mixed")}>
            <option value="number">纯数字</option>
            <option value="letter">纯字母</option>
            <option value="mixed">混合</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-2 mb-1 font-medium">前缀长度</label>
          <input type="number" min={1} max={10} className="w-full px-2 py-1.5 border border-border-strong rounded text-[13px]" value={prefixLen} onChange={(e) => setPrefixLen(Number(e.target.value))} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} className="accent-brand" />
            递归
          </label>
        </div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Button onClick={() => preview(true)} disabled={running}>👁️ 预览(加前缀)</Button>
        <Button onClick={() => preview(false)} disabled={running}>👁️ 预览(还原)</Button>
        <Button variant="primary" onClick={run} disabled={running || items.length === 0}>
          {running ? "执行中…" : `✓ 执行(${items.length})`}
        </Button>
      </div>
      {items.length > 0 && (
        <div className="border border-border rounded-md overflow-auto max-h-[320px]">
          <table className="w-full text-[12.5px]">
            <thead className="bg-bg-soft sticky top-0">
              <tr className="text-left text-text-2 text-xs">
                <th className="px-2 py-1.5">原文件名</th>
                <th className="px-2 py-1.5">→ 新文件名</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-bg-soft2">
                  <td className="px-2 py-1.5 truncate max-w-[200px]">{it.oldName}</td>
                  <td className="px-2 py-1.5 text-brand-strong truncate max-w-[200px]">{it.newName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
