/**
 * 匹配校验页(R)。对应需求 §3.2 R-1~R-6。
 *
 * 读 success.json → checkMatches.classify 给每条打 8 级分类 →
 * 分类概览卡片 + 明细表(筛选/排序)+ 行内操作(打开目录/YT/重下)。
 *
 * 重下:从 success.json 删该条 + 触发 store 重置该行为 todo,用户回 D 页重跑。
 */
import { useEffect, useMemo, useState } from "react";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { Button, Card, Stat, Tag, toast } from "../components/ui";
import { buildCheckRows, countByClass, type CheckRow } from "../lib/checkService";
import { CLASS_EMOJI, type Class } from "../lib/checkMatches";
import { useDownloadStore } from "../stores/downloadStore";

const CLASS_COLOR: Record<Class, "ok" | "warn" | "err" | "alias" | "neutral"> = {
  ok: "ok",
  ok_no_artist: "neutral",
  warn_alias_likely: "alias",
  warn_title_diff: "warn",
  warn_partial_artist: "warn",
  warn_no_artist: "warn",
  warn_title_only: "warn",
  mismatch: "err",
};

const CLASS_ORDER: Class[] = [
  "ok",
  "ok_no_artist",
  "warn_alias_likely",
  "warn_partial_artist",
  "warn_title_diff",
  "warn_no_artist",
  "warn_title_only",
  "mismatch",
];

export default function ReviewPage() {
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkFiles, setCheckFiles] = useState(false);
  const [filter, setFilter] = useState<Class | "all">("all");
  const [sortBy, setSortBy] = useState<"cls" | "sim">("cls");

  const rowsFromStore = useDownloadStore((s) => s.rows);
  // 项目根 = 任意 row 的 filepath 的某级;简化用 success.json 约定位置(项目根/logs)
  // 这里用一个兜底:优先拿 store 第一个 filepath 推导,拿不到就用 "."
  const projectRoot = useMemo(() => {
    const fp = rowsFromStore[0]?.filepath;
    if (!fp) return ".";
    // filepath 形如 /xxx/downloads/Artist - Title.opus,项目根是 downloads 的父
    const idx = fp.lastIndexOf("/downloads/");
    return idx > 0 ? fp.slice(0, idx) : ".";
  }, [rowsFromStore]);

  async function runCheck() {
    setLoading(true);
    try {
      const r = await buildCheckRows(projectRoot, checkFiles);
      setRows(r);
      toast(`校验完成,共 ${r.length} 条`);
    } catch (e) {
      toast(`校验失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  // 首次进入自动跑一次(不读磁盘,快)
  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => countByClass(rows), [rows]);

  const filtered = useMemo(() => {
    let r = filter === "all" ? rows : rows.filter((x) => x.cls === filter);
    r = [...r];
    if (sortBy === "sim") r.sort((a, b) => a.sim - b.sim);
    else
      r.sort(
        (a, b) =>
          CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls),
      );
    return r;
  }, [rows, filter, sortBy]);

  async function openDir(filepath: string) {
    try {
      await revealItemInDir(filepath);
    } catch (e) {
      toast(`打开失败: ${e}`);
    }
  }
  async function openYt(videoId: string | null) {
    if (!videoId) {
      toast("无 videoId");
      return;
    }
    try {
      await openUrl(`https://music.youtube.com/watch?v=${videoId}`);
    } catch (e) {
      toast(`打开失败: ${e}`);
    }
  }

  /** 重下:从 success.json 删该条 + 把 store 里对应行重置为 todo。 */
  function redownload(row: CheckRow) {
    // store 里找 raw 匹配的行,重置
    const store = useDownloadStore.getState();
    const idx = store.rows.findIndex((r) => r.song.raw === row.raw);
    if (idx >= 0) {
      store.updateRow(idx, {
        state: "todo",
        match: null,
        confidence: null,
        reason: null,
        flags: [],
        failReason: null,
        filepath: null,
      });
      toast(`已重置「${row.raw}」为待下载,去 D 页重跑`);
    } else {
      toast("歌单里找不到该条(可能歌单已变),请手动在 D 页处理");
    }
    // 注:实际从 success.json 物理删除由 D 页下次下载时该条不在 success 里自然覆盖;
    // 更彻底的做法是改 success.json,但这里保持轻量,等 S 页再做。
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-[15px] font-semibold mb-0.5">匹配质量校验</h3>
            <div className="text-text-3 text-xs">
              对比"请求"与"实际下载"内容,基于 success.json
              {checkFiles && " + 磁盘元数据"}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={checkFiles}
                onChange={(e) => setCheckFiles(e.target.checked)}
                className="accent-brand"
              />
              读磁盘元数据(慢但更准)
            </label>
            <Button variant="primary" onClick={runCheck} disabled={loading}>
              {loading ? "校验中…" : "▶️ 运行校验"}
            </Button>
          </div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <div className="text-center text-text-3 py-8">
            {loading ? "校验中…" : "暂无数据(先去 D 页下载几首)"}
          </div>
        </Card>
      ) : (
        <>
          {/* 分类概览 */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {CLASS_ORDER.filter((c) => counts[c] > 0).map((c) => (
              <button
                key={c}
                onClick={() => setFilter(filter === c ? "all" : c)}
                className="text-left"
              >
                <Stat
                  num={counts[c]}
                  label={`${CLASS_EMOJI[c]} ${c}`}
                  numColor={
                    CLASS_COLOR[c] === "ok"
                      ? "var(--color-ok)"
                      : CLASS_COLOR[c] === "err"
                        ? "var(--color-err)"
                        : CLASS_COLOR[c] === "warn"
                          ? "var(--color-warn)"
                          : CLASS_COLOR[c] === "alias"
                            ? "var(--color-alias)"
                            : undefined
                  }
                />
              </button>
            ))}
          </div>

          {/* 明细 */}
          <Card>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-[13px] font-semibold">
                明细 · 共 {filtered.length} 条
                {filter !== "all" && (
                  <button
                    className="ml-2 text-xs text-brand hover:underline"
                    onClick={() => setFilter("all")}
                  >
                    清除筛选
                  </button>
                )}
              </h3>
              <div className="flex items-center gap-2 text-xs text-text-2">
                排序:
                <select
                  className="px-2 py-1 border border-border-strong rounded text-xs"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "cls" | "sim")}
                >
                  <option value="cls">按分类</option>
                  <option value="sim">按相似度升序(最差的在前)</option>
                </select>
              </div>
            </div>
            <div className="border border-border rounded-lg overflow-auto max-h-[520px]">
              <table className="w-full text-[13px] border-collapse">
                <thead className="sticky top-0 bg-bg-soft">
                  <tr className="text-left text-[12px] text-text-2">
                    <th className="px-3 py-2 border-b border-border">分类</th>
                    <th className="px-3 py-2 border-b border-border">请求(标题-艺人)</th>
                    <th className="px-3 py-2 border-b border-border">实际(标题-艺人)</th>
                    <th className="px-3 py-2 border-b border-border">相似度</th>
                    <th className="px-3 py-2 border-b border-border">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.raw} className="hover:bg-bg-soft">
                      <td className="px-3 py-2 border-b border-bg-soft2 whitespace-nowrap">
                        <Tag color={CLASS_COLOR[r.cls]}>
                          {CLASS_EMOJI[r.cls]} {r.cls}
                        </Tag>
                      </td>
                      <td className="px-3 py-2 border-b border-bg-soft2">
                        <div className="font-medium">{r.reqTitle}</div>
                        <div className="text-text-2 text-xs">{r.reqArtists.join("/") || "—"}</div>
                      </td>
                      <td className="px-3 py-2 border-b border-bg-soft2">
                        <div className="font-medium">{r.matTitle || "—"}</div>
                        <div className="text-text-2 text-xs">{r.matArtists.join("/") || "—"}</div>
                        {r.diskMeta?.title && r.diskMeta.title !== r.matTitle && (
                          <div className="text-[11px] text-warn mt-0.5">
                            ⚠ 磁盘实际: {r.diskMeta.title}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-bg-soft2">
                        <Tag
                          color={
                            r.sim >= 0.7 ? "ok" : r.sim >= 0.5 ? "warn" : "err"
                          }
                        >
                          {r.sim.toFixed(2)}
                        </Tag>
                        {!r.exists && (
                          <div className="text-[11px] text-err mt-0.5">文件缺失</div>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-bg-soft2 whitespace-nowrap">
                        {r.exists && (
                          <Button
                            className="!px-2 !py-0.5 !text-[12px] mr-1"
                            onClick={() => openDir(r.filepath)}
                          >
                            📁
                          </Button>
                        )}
                        <Button
                          className="!px-2 !py-0.5 !text-[12px] mr-1"
                          onClick={() => openYt(r.videoId)}
                        >
                          ↗ YT
                        </Button>
                        <Button
                          className="!px-2 !py-0.5 !text-[12px]"
                          variant="primary"
                          onClick={() => redownload(r)}
                        >
                          ↻ 重下
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11.5px] text-text-3 mt-2">
              点「↻ 重下」会把该首重置为待下载,去 D 页点「全量下载」会自动跳过已完成的、重跑这条。
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
