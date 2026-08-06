/**
 * URL 直下页(U)。对应需求 §3.5 U-1~U-3。
 *
 * 粘贴/导入 URL 列表 → 跳过搜索直接下载 → 实时进度。
 * 复用 urlDownload 服务 + downloadStore 的日志。
 */
import { useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Card, Progress, Tag, toast } from "../components/ui";
import { parseUrlList, downloadUrl, type UrlRow } from "../lib/urlDownload";
import { getConfig } from "../lib/config";
import { useDownloadStore } from "../stores/downloadStore";

export default function UrlsPage() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<UrlRow[]>([]);
  const [running, setRunning] = useState(false);
  const [downloadsDir, setDownloadsDir] = useState(getConfig().downloadsDir);
  const cancelledRef = useRef(false);
  const log = useDownloadStore((s) => s.log);

  const counts = useMemo(() => {
    const c = { todo: 0, downloading: 0, done: 0, failed: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);

  const progress = rows.length ? (counts.done / rows.length) * 100 : 0;

  function updateRow(idx: number, patch: Partial<UrlRow>) {
    setRows((prev) => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  async function pickFile() {
    const p = await open({ filters: [{ name: "Text", extensions: ["txt"] }] });
    if (typeof p === "string") {
      setText(await readTextFile(p));
      toast(`已导入 ${p}`);
    }
  }

  async function pickDir() {
    const d = await open({ directory: true });
    if (typeof d === "string") {
      setDownloadsDir(d);
      toast(`下载到: ${d}`);
    }
  }

  async function start() {
    if (running) {
      toast("已有任务在运行");
      return;
    }
    const parsed = parseUrlList(text);
    if (parsed.length === 0) {
      toast("URL 列表为空");
      return;
    }
    setRows(parsed);
    setRunning(true);
    cancelledRef.current = false;
    log("info", `URL 直下开始,共 ${parsed.length} 个`);

    const cfg = getConfig();
    for (let i = 0; i < parsed.length; i++) {
      if (cancelledRef.current) {
        log("warn", "用户停止");
        break;
      }
      if (parsed[i].state === "done") continue;
      updateRow(i, { state: "downloading" });
      log("info", `[${i + 1}/${parsed.length}] ${parsed[i].url}`);
      const result = await downloadUrl(parsed[i], cfg, downloadsDir, log);
      updateRow(i, result);
      if (result.state === "done") {
        log("ok", `  完成 → ${result.filepath}`);
      } else {
        log("err", `  ${result.failReason}`);
      }
    }
    setRunning(false);
    log("ok", "批次结束");
  }

  function stop() {
    cancelledRef.current = true;
    setRunning(false);
    toast("已请求停止");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-semibold">URL 列表</h3>
            <Button variant="ghost" onClick={pickFile}>📄 从文件导入</Button>
          </div>
          <textarea
            className="w-full px-3 py-2 border border-border-strong rounded-md text-[12.5px] font-mono min-h-[180px] resize-y"
            placeholder={"https://music.youtube.com/watch?v=...\nhttps://www.youtube.com/watch?v=...\nhttps://youtu.be/...\n# 注释行以 # 开头"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="text-[11.5px] text-text-3 mt-2">解析出 {parseUrlList(text).length} 个 URL(自动去重)</div>
        </Card>

        <Card>
          <h3 className="text-[13px] font-semibold mb-3">下载</h3>
          <div className="mb-3">
            <label className="block text-xs text-text-2 mb-1 font-medium">📁 下载到目录</label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-2.5 py-1.5 border border-border-strong rounded-md text-[13px] font-mono"
                value={downloadsDir}
                onChange={(e) => setDownloadsDir(e.target.value)}
              />
              <Button onClick={pickDir}>浏览…</Button>
            </div>
          </div>
          <Progress value={progress} />
          <div className="text-xs text-text-3 mt-2 mb-3">
            {counts.done} / {rows.length} 完成
            {counts.failed > 0 && <span className="text-err"> · 失败 {counts.failed}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={start} disabled={running}>
              {running ? "下载中…" : "⬇️ 开始下载"}
            </Button>
            <Button variant="danger" onClick={stop} disabled={!running}>⏹ 停止</Button>
          </div>
        </Card>
      </div>

      {rows.length > 0 && (
        <Card>
          <h3 className="text-[13px] font-semibold mb-3">明细</h3>
          <div className="border border-border rounded-md overflow-auto max-h-[420px]">
            <table className="w-full text-[13px]">
              <thead className="bg-bg-soft sticky top-0">
                <tr className="text-left text-text-2 text-xs">
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">URL / videoId</th>
                  <th className="px-3 py-2">实际标题</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-bg-soft2 hover:bg-bg-soft">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.state === "done" && <Tag color="ok">✓ 完成</Tag>}
                      {r.state === "downloading" && <Tag color="info"><span className="spinner" /> 下载中</Tag>}
                      {r.state === "failed" && <Tag color="err">✗ 失败</Tag>}
                      {r.state === "todo" && <Tag color="neutral">待下载</Tag>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-2 truncate max-w-[240px]" title={r.url}>
                      {r.videoId ?? r.url}
                    </td>
                    <td className="px-3 py-2">
                      {r.title ? (
                        <div>
                          <div className="text-[12.5px]">{r.title}</div>
                          {r.artist && <div className="text-text-2 text-xs">{r.artist}</div>}
                        </div>
                      ) : r.failReason ? (
                        <span className="text-[12px] text-err">{r.failReason}</span>
                      ) : (
                        <span className="text-text-3 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.state === "done" && r.filepath && (
                        <Button
                          className="!px-2 !py-0.5 !text-[12px]"
                          onClick={() => revealItemInDir(r.filepath!).catch((e) => toast(`失败: ${e}`))}
                        >
                          📁
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
