/**
 * 下载页(D)。对应需求 §3.1 D-1~D-12 + §3.8 帮助入口。
 *
 * 功能:歌单编辑/导入、自定义下载目录(D-9)、质量策略(D-11)、
 *      实时进度、明细表含置信度列(D-10)、候选确认弹层(D-11)、
 *      待确认队列(D-12)、断点续传(D-4)、并发控制(D-6)、停止(D-7)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { Button, Card, Progress, Stat, Tag, toast } from "../components/ui";
import { loadSongs } from "../lib/parseList";
import { loadConfig, saveConfig, getConfig, type AppConfig } from "../lib/config";
import { runBatch } from "../lib/downloadOrchestrator";
import type { SearchResult } from "../lib/pickBest";
import { useDownloadStore, type Row, type RowState } from "../stores/downloadStore";

const CONFIRM_LABEL = { confirm: "存疑逐条确认", skip: "存疑直接跳过", auto: "全部自动" } as const;

export default function DownloadPage() {
  const [cfg, setCfg] = useState<AppConfig>(getConfig());
  const [songText, setSongText] = useState<string>("");
  const [downloadsDir, setDownloadsDir] = useState<string>(cfg.downloadsDir);
  const [confirmPolicy, setConfirmPolicy] = useState<AppConfig["confirmPolicy"]>(cfg.confirmPolicy);
  const [filter, setFilter] = useState<"all" | RowState>("all");

  const rows = useDownloadStore((s) => s.rows);
  const isRunning = useDownloadStore((s) => s.isRunning);
  const logs = useDownloadStore((s) => s.logs);
  const setSongs = useDownloadStore((s) => s.setSongs);
  const updateRow = useDownloadStore((s) => s.updateRow);
  const setRunning = useDownloadStore((s) => s.setRunning);
  const log = useDownloadStore((s) => s.log);

  const cancelledRef = useRef(false);
  const confirmResolverRef = useRef<null | ((r: { action: "download" | "skip"; pick?: SearchResult }) => void)>(null);
  const [confirmState, setConfirmState] = useState<null | {
    idx: number;
    best: SearchResult;
    candidates: SearchResult[];
    reason: string;
  }>(null);

  // 首次加载配置
  useEffect(() => {
    loadConfig().then((c) => {
      setCfg(c);
      setDownloadsDir(c.downloadsDir);
      setConfirmPolicy(c.confirmPolicy);
    });
  }, []);

  // 歌单文本变化 → 解析进 store
  useEffect(() => {
    setSongs(loadSongs(songText));
  }, [songText, setSongs]);

  const counts = useMemo(() => {
    const c = { todo: 0, done: 0, pending: 0, failed: 0, skipped: 0, downloading: 0, searching: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows.map((r, i) => ({ r, i }));
    return rows.map((r, i) => ({ r, i })).filter(({ r }) => r.state === filter);
  }, [rows, filter]);

  const doneCount = counts.done;
  const totalCount = rows.length;
  const progress = totalCount ? (doneCount / totalCount) * 100 : 0;

  async function pickSongsFile() {
    try {
      const path = await open({ filters: [{ name: "Text", extensions: ["txt"] }] });
      if (typeof path === "string") {
        const text = await readTextFile(path);
        setSongText(text);
        toast(`已导入 ${path}`);
      }
    } catch (e) {
      toast(`导入失败: ${e}`);
    }
  }

  async function pickDir() {
    try {
      const dir = await open({ directory: true });
      if (typeof dir === "string") {
        setDownloadsDir(dir);
        toast(`下载到: ${dir}`);
      }
    } catch (e) {
      toast(`选择失败: ${e}`);
    }
  }

  async function persistConfig(patch: Partial<AppConfig>) {
    const next = { ...getConfig(), ...patch };
    setCfg(next);
    try {
      await saveConfig(next);
    } catch (e) {
      toast(`配置保存失败: ${e}`);
    }
  }

  async function startBatch(mode: "all" | "test") {
    if (isRunning) {
      toast("已有任务在运行");
      return;
    }
    if (rows.length === 0) {
      toast("歌单为空");
      return;
    }
    // test 模式:固定种子抽 5 首(简化:前 5 条)
    let target: Row[] = rows;
    if (mode === "test") {
      const n = Math.min(5, rows.length);
      target = rows.slice(0, n);
      // 把非前 n 条标记 done 跳过(简化演示)
    }
    cancelledRef.current = false;
    setRunning(true);
    log("info", `${mode === "all" ? "全量" : "测试"}下载开始 → 输出: ${downloadsDir}`);
    log("info", `质量策略: ${CONFIRM_LABEL[confirmPolicy]}`);

    await persistConfig({ downloadsDir, confirmPolicy });

    await runBatch(
      target,
      getConfig(),
      downloadsDir,
      {
        onRowUpdate: updateRow,
        onLog: log,
        onAllDone: () => {
          setRunning(false);
          log("ok", "批次结束");
        },
        onConfirmNeeded: (idx, best, candidates, reason) =>
          new Promise((resolve) => {
            confirmResolverRef.current = resolve;
            setConfirmState({ idx, best, candidates, reason });
          }),
      },
      () => cancelledRef.current,
    );
  }

  function stopBatch() {
    cancelledRef.current = true;
    setRunning(false);
    toast("已请求停止");
  }

  function resolveConfirm(action: "download" | "skip", pick?: SearchResult) {
    if (confirmResolverRef.current) {
      confirmResolverRef.current({ action, pick });
      confirmResolverRef.current = null;
      setConfirmState(null);
    }
  }

  const [pickedCand, setPickedCand] = useState(0);

  return (
    <div className="space-y-4">
      {/* 目标与策略 */}
      <Card>
        <h3 className="text-[13px] font-semibold mb-3">下载目标与策略</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-2 mb-1 font-medium">📁 下载到目录</label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-2.5 py-1.5 border border-border-strong rounded-md text-[13px] bg-bg"
                value={downloadsDir}
                onChange={(e) => setDownloadsDir(e.target.value)}
              />
              <Button onClick={pickDir}>浏览…</Button>
              <Button variant="ghost" onClick={() => setDownloadsDir(cfg.downloadsDir)} title="恢复默认">↺</Button>
            </div>
            <div className="text-[11.5px] text-text-3 mt-1">音频落这里;整理后生成 ok/ mismatch/ 等子目录</div>
          </div>
          <div>
            <label className="block text-xs text-text-2 mb-1 font-medium">⚠️ 质量存疑项处理</label>
            <select
              className="w-full px-2.5 py-1.5 border border-border-strong rounded-md text-[13px] bg-bg"
              value={confirmPolicy}
              onChange={(e) => {
                const v = e.target.value as AppConfig["confirmPolicy"];
                setConfirmPolicy(v);
                persistConfig({ confirmPolicy: v });
              }}
            >
              <option value="confirm">{CONFIRM_LABEL.confirm}(推荐)</option>
              <option value="skip">{CONFIRM_LABEL.skip}</option>
              <option value="auto">{CONFIRM_LABEL.auto}(事后去校验页 review)</option>
            </select>
            <div className="text-[11.5px] text-text-3 mt-1">"存疑"= 疑似翻唱/MV/Live/Medley 或艺人对不上</div>
          </div>
        </div>
      </Card>

      {/* 歌单编辑 */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">歌单(每行 `歌名-艺人`,多艺人用 _ 分隔)</h3>
          <div className="flex gap-2">
            <Button onClick={pickSongsFile}>📄 导入 txt</Button>
            <span className="text-xs text-text-3 self-center">解析后 {rows.length} 首</span>
          </div>
        </div>
        <textarea
          className="w-full px-3 py-2 border border-border-strong rounded-md text-[12.5px] font-mono min-h-[100px] resize-y"
          placeholder={"起风了-买辣椒也用券\nGee-少女时代\nMonica-"}
          value={songText}
          onChange={(e) => setSongText(e.target.value)}
        />
      </Card>

      {/* 统计 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
        <Stat num={totalCount} label="歌单总数" icon="🎵" />
        <Stat num={counts.done} label="已下载" numColor="var(--color-ok)" icon="✅" />
        <Stat num={counts.failed} label="失败" numColor="var(--color-err)" icon="❌" />
        <Stat num={counts.todo + counts.pending} label="待下载" numColor="var(--color-warn)" icon="⏳" />
        <Stat num={counts.pending} label="待确认" numColor="var(--color-warn)" icon="🟠" />
      </div>

      {/* 下载控制 */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">下载控制</h3>
          <Tag color={isRunning ? "info" : "neutral"}>{isRunning ? "运行中" : "空闲"}</Tag>
        </div>
        <Progress value={progress} />
        <div className="flex justify-between text-xs text-text-3 mt-2 mb-3">
          <span>
            {doneCount} / {totalCount} 完成
          </span>
          {isRunning && counts.searching + counts.downloading > 0 && (
            <span className="flex items-center gap-1">
              <span className="spinner" /> {counts.searching ? "搜索中" : "下载中"}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="primary" onClick={() => startBatch("all")}>⬇️ 全量下载</Button>
          <Button onClick={() => startBatch("test")}>🎲 测试 5 首</Button>
          <Button variant="ghost" onClick={() => toast("断点续传:已完成项自动跳过")}>⏏️ 断点续传</Button>
          <div className="flex-1" />
          <Button variant="danger" onClick={stopBatch} disabled={!isRunning}>⏹ 停止</Button>
        </div>
      </Card>

      {/* 明细表 */}
      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-[13px] font-semibold">明细</h3>
          <div className="flex gap-1 bg-bg-soft2 p-0.5 rounded-md">
            {([
              ["all", `全部 ${totalCount}`],
              ["todo", `待下载 ${counts.todo}`],
              ["done", `已完成 ${counts.done}`],
              ["pending", `🟠 待确认 ${counts.pending}`],
              ["failed", `失败 ${counts.failed}`],
            ] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[12.5px] rounded-[5px] ${
                  filter === f ? "bg-bg shadow-sm" : "text-text-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="border border-border rounded-lg overflow-auto max-h-[420px]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 bg-bg-soft">
              <tr className="text-left text-[12px] text-text-2">
                <th className="px-3 py-2 border-b border-border">状态</th>
                <th className="px-3 py-2 border-b border-border">标题</th>
                <th className="px-3 py-2 border-b border-border">艺人</th>
                <th className="px-3 py-2 border-b border-border">实际匹配 / 质量标注</th>
                <th className="px-3 py-2 border-b border-border">置信度</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-text-3">
                    {totalCount === 0 ? "歌单为空,先在上方编辑或导入" : "该分类无条目"}
                  </td>
                </tr>
              )}
              {filteredRows.map(({ r, i }) => (
                <RowRow key={i} row={r} onConfirm={() => resolveConfirm("skip")} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11.5px] text-text-3 mt-2">
          置信度:
          <Tag color="ok" className="mx-1">高</Tag>自动下载 ·
          <Tag color="warn" className="mx-1">中</Tag>按策略 ·
          <Tag color="err" className="mx-1">低</Tag>默认进待确认
        </div>
      </Card>

      {/* 日志 */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold">运行日志</h3>
          <Button variant="ghost" className="text-xs" onClick={() => useDownloadStore.getState().clearLogs()}>清空</Button>
        </div>
        <div className="bg-[#0f172a] text-[#cbd5e1] font-mono text-[11.5px] rounded-md p-3 max-h-[180px] overflow-auto">
          {logs.length === 0 ? (
            <div className="text-[#64748b]">暂无日志</div>
          ) : (
            logs.map((l, k) => (
              <div key={k}>
                <span className="text-[#64748b]">{new Date(l.time).toLocaleTimeString("zh-CN", { hour12: false })}</span>{" "}
                <span
                  className={
                    l.level === "ok" ? "text-[#86efac]" :
                    l.level === "warn" ? "text-[#fcd34d]" :
                    l.level === "err" ? "text-[#fca5a5]" : "text-[#93c5fd]"
                  }
                >
                  [{l.level.toUpperCase()}]
                </span>{" "}
                {l.msg}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* 候选确认弹层 */}
      {confirmState && (
        <div
          className="fixed inset-0 bg-[rgba(15,23,42,.45)] flex items-center justify-center z-50"
          style={{ display: "flex" }}
        >
          <Card className="w-[720px] max-w-[92vw] max-h-[86vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-semibold m-0">🟠 这首歌的最优候选质量存疑,请确认</h3>
              <Button variant="ghost" onClick={() => resolveConfirm("skip")}>✕</Button>
            </div>
            <div className="bg-warn-soft border-l-[3px] border-warn p-3 rounded-md my-2 text-[13px]">
              <b>⚠ {confirmState.reason}</b>
            </div>
            <div className="text-xs text-text-2 mb-3">
              请求下载:<b>{rows[confirmState.idx]?.song.title} - {rows[confirmState.idx]?.song.artists.join("/")}</b>
            </div>
            <h4 className="text-[13px] font-semibold mb-2">YT 返回的全部候选</h4>
            <div className="border border-border rounded-md overflow-auto max-h-[300px] mb-4">
              <table className="w-full text-[12.5px]">
                <thead className="bg-bg-soft">
                  <tr className="text-left text-text-2">
                    <th className="px-2 py-1.5"></th>
                    <th className="px-2 py-1.5">标题</th>
                    <th className="px-2 py-1.5">频道/上传者</th>
                    <th className="px-2 py-1.5">标注</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmState.candidates.map((c, k) => (
                    <tr
                      key={k}
                      className="cursor-pointer"
                      style={{ background: k === pickedCand ? "var(--color-brand-soft)" : undefined }}
                      onClick={() => setPickedCand(k)}
                    >
                      <td className="px-2 py-1.5">
                        <input type="radio" checked={k === pickedCand} onChange={() => setPickedCand(k)} className="accent-brand" />
                      </td>
                      <td className="px-2 py-1.5">{c.title}</td>
                      <td className="px-2 py-1.5 text-text-2">{c.uploader}</td>
                      <td className="px-2 py-1.5">{k === 0 && <Tag color="warn">最优(存疑)</Tag>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => resolveConfirm("download")}>✓ 用第 1 个(最优)下载</Button>
              <Button onClick={() => resolveConfirm("download", confirmState.candidates[pickedCand])}>🎯 用我选的候选下载</Button>
              <Button onClick={() => resolveConfirm("skip")}>⏭ 跳过这首</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function RowRow({ row, onConfirm: _onConfirm }: { row: Row; onConfirm: () => void }) {
  const stateMap: Record<RowState, { tag: string; color: "ok" | "info" | "warn" | "err" | "neutral" }> = {
    todo: { tag: "待下载", color: "neutral" },
    searching: { tag: "搜索中", color: "info" },
    downloading: { tag: "下载中", color: "info" },
    done: { tag: "✓ 已完成", color: "ok" },
    failed: { tag: "✗ 失败", color: "err" },
    pending: { tag: "🟠 待确认", color: "warn" },
    skipped: { tag: "⏭ 已跳过", color: "neutral" },
  };
  const s = stateMap[row.state];

  return (
    <tr className="hover:bg-bg-soft">
      <td className="px-3 py-2 border-b border-bg-soft2">
        <Tag color={s.color}>
          {(row.state === "searching" || row.state === "downloading") && <span className="spinner" />}
          {s.tag}
        </Tag>
      </td>
      <td className="px-3 py-2 border-b border-bg-soft2 font-medium">{row.song.title}</td>
      <td className="px-3 py-2 border-b border-bg-soft2 text-text-2">{row.song.artists.join("/") || "—"}</td>
      <td className="px-3 py-2 border-b border-bg-soft2">
        {row.match ? (
          <div>
            <div className="text-[12.5px]">
              <b>{row.match.title}</b> <span className="text-text-2 text-xs">· {row.match.uploader}</span>
            </div>
            {row.reason && <div className="text-[11.5px] text-warn mt-0.5">⚠ {row.reason}</div>}
            {row.failReason && <div className="text-[11.5px] text-err mt-0.5">{row.failReason}</div>}
          </div>
        ) : row.failReason ? (
          <span className="text-[12px] text-err">{row.failReason}</span>
        ) : (
          <span className="text-text-3 text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2 border-b border-bg-soft2">
        {row.confidence === "high" && <Tag color="ok">高</Tag>}
        {row.confidence === "medium" && <Tag color="warn">中</Tag>}
        {row.confidence === "low" && <Tag color="err">低</Tag>}
        {!row.confidence && <span className="text-text-3 text-xs">—</span>}
      </td>
    </tr>
  );
}
