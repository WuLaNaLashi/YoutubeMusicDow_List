/**
 * 文件整理页(O)。对应需求 §3.3 O-1/O-2/O-3。
 *
 * 两个操作(dry-run 预览 / apply):
 *   1. 按分类挪文件:success.json + classify → downloads/{cls}/
 *   2. 按内嵌元数据改名:{真实艺人} - {真实标题}
 *
 * 加目录浏览(list_dir)。
 */
import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Card, Tag, toast } from "../components/ui";
import {
  planMoveByClass,
  applyMoveByClass,
  planRenameByMetadata,
  applyRename,
  type MovePlan,
  type RenamePlan,
} from "../lib/organizeService";
import { listDir, type DirEntry } from "../api/tauri";
import { useDownloadStore } from "../stores/downloadStore";
import { CLASS_EMOJI, type Class } from "../lib/checkMatches";

type Mode = "move" | "rename" | "browse";

export default function OrganizePage() {
  const [mode, setMode] = useState<Mode>("move");

  const rowsFromStore = useDownloadStore((s) => s.rows);
  const downloadsDir = useMemo(() => {
    const fp = rowsFromStore[0]?.filepath;
    if (!fp) return "downloads";
    const idx = fp.lastIndexOf("/downloads/");
    return idx > 0 ? fp.slice(0, idx + 10) : "downloads";
  }, [rowsFromStore]);
  const projectRoot = useMemo(() => {
    const fp = rowsFromStore[0]?.filepath;
    if (!fp) return ".";
    const idx = fp.lastIndexOf("/downloads/");
    return idx > 0 ? fp.slice(0, idx) : ".";
  }, [rowsFromStore]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg-soft2 p-0.5 rounded-md w-fit">
        {([
          ["move", "🗂️ 按分类挪文件"],
          ["rename", "✏️ 按元数据改名"],
          ["browse", "📁 目录浏览"],
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

      {mode === "move" && <MoveMode projectRoot={projectRoot} downloadsDir={downloadsDir} />}
      {mode === "rename" && <RenameMode projectRoot={projectRoot} downloadsDir={downloadsDir} />}
      {mode === "browse" && <BrowseMode downloadsDir={downloadsDir} />}
    </div>
  );
}

// ---- 按分类挪文件 ----
function MoveMode({ projectRoot, downloadsDir }: { projectRoot: string; downloadsDir: string }) {
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [copy, setCopy] = useState(false);
  const [applied, setApplied] = useState<{ moved: number; failed: number } | null>(null);

  async function gen() {
    setLoading(true);
    setApplied(null);
    try {
      const p = await planMoveByClass(projectRoot, downloadsDir);
      setPlan(p);
    } catch (e) {
      toast(`生成计划失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!plan) return;
    setLoading(true);
    try {
      const r = await applyMoveByClass(plan, copy);
      setApplied({ moved: r.moved, failed: r.failed });
      toast(`完成:移动 ${r.moved},失败 ${r.failed}`);
      await gen(); // 刷新
    } catch (e) {
      toast(`执行失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    gen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-[13px] font-semibold mb-0.5">按分类挪文件</h3>
          <div className="text-text-3 text-xs">把 downloads/ 里的文件按 check_matches 分类挪进 {downloadsDir}/{"{cls}"}/(幂等)</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="accent-brand" />
            复制(不删源)
          </label>
          <Button variant="ghost" onClick={gen} disabled={loading}>↻ 刷新计划</Button>
        </div>
      </div>

      {!plan ? (
        <div className="text-center text-text-3 py-6">{loading ? "计算中…" : "无数据"}</div>
      ) : (
        <>
          {applied && (
            <div className="bg-ok-soft text-ok px-3 py-2 rounded-md mb-3 text-[13px]">
              ✓ 已移动 {applied.moved} 个文件{applied.failed > 0 && `,失败 ${applied.failed}`}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
            <div className="bg-bg-soft px-3 py-2 rounded">待移动: <b>{Object.values(plan.byCls).reduce((a, b) => a + b, 0)}</b></div>
            <div className="bg-bg-soft px-3 py-2 rounded">已就位: <b>{plan.alreadyCorrectCount}</b></div>
            <div className="bg-bg-soft px-3 py-2 rounded text-err">缺失: <b>{plan.missingCount}</b></div>
          </div>
          {Object.keys(plan.byCls).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {Object.entries(plan.byCls).map(([cls, n]) => (
                <Tag key={cls} color={cls === "ok" ? "ok" : cls === "mismatch" ? "err" : "warn"}>
                  {CLASS_EMOJI[cls as Class]} {cls}/ ({n})
                </Tag>
              ))}
            </div>
          )}
          <div className="border border-border rounded-md overflow-auto max-h-[360px] mb-3">
            <table className="w-full text-[12.5px]">
              <thead className="bg-bg-soft sticky top-0">
                <tr className="text-left text-text-2">
                  <th className="px-2 py-1.5">原文件</th>
                  <th className="px-2 py-1.5">目标子目录</th>
                  <th className="px-2 py-1.5">状态</th>
                </tr>
              </thead>
              <tbody>
                {plan.items
                  .filter((i) => !i.alreadyCorrect)
                  .map((i) => (
                    <tr key={i.raw} className="border-b border-bg-soft2">
                      <td className="px-2 py-1.5 truncate max-w-[260px]" title={i.src}>{i.src.split(/[\\/]/).pop()}</td>
                      <td className="px-2 py-1.5">
                        {i.missing ? "—" : <Tag color={i.cls === "ok" ? "ok" : i.cls === "mismatch" ? "err" : "warn"}>{i.cls}/</Tag>}
                      </td>
                      <td className="px-2 py-1.5">
                        {i.missing ? <span className="text-err text-xs">文件缺失</span> : <span className="text-warn text-xs">待移动</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={run} disabled={loading || Object.values(plan.byCls).reduce((a, b) => a + b, 0) === 0}>
              {loading ? "执行中…" : `✓ 执行(移动 ${Object.values(plan.byCls).reduce((a, b) => a + b, 0)} 个)`}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---- 按元数据改名 ----
const ALL_RENAME_CLASSES: Class[] = [
  "mismatch",
  "warn_title_diff",
  "warn_alias_likely",
  "warn_partial_artist",
  "warn_no_artist",
  "warn_title_only",
  "ok_no_artist",
];

function RenameMode({ projectRoot, downloadsDir }: { projectRoot: string; downloadsDir: string }) {
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<Class>>(new Set(["mismatch", "warn_title_diff"]));
  const [applied, setApplied] = useState<{ renamed: number; failed: number } | null>(null);

  async function gen() {
    setLoading(true);
    setApplied(null);
    try {
      const p = await planRenameByMetadata(projectRoot, downloadsDir, selected);
      setPlan(p);
    } catch (e) {
      toast(`生成计划失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!plan) return;
    setLoading(true);
    try {
      const r = await applyRename(plan);
      setApplied({ renamed: r.renamed, failed: r.failed });
      toast(`完成:改名 ${r.renamed},失败 ${r.failed}`);
      await gen();
    } catch (e) {
      toast(`执行失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    gen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCls(c: Class) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-[13px] font-semibold mb-0.5">按内嵌元数据改名</h3>
          <div className="text-text-3 text-xs">改成「{`{真实艺人} - {真实标题}`}」,让文件名和内容一致</div>
        </div>
        <Button variant="ghost" onClick={gen} disabled={loading}>↻ 刷新</Button>
      </div>

      <div className="mb-3">
        <div className="text-xs text-text-2 mb-1.5">改名的分类(多选)</div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_RENAME_CLASSES.map((c) => (
            <button
              key={c}
              onClick={() => toggleCls(c)}
              className={`px-2.5 py-1 rounded-full text-[11.5px] border ${
                selected.has(c)
                  ? "bg-brand-soft text-brand-strong border-brand"
                  : "bg-bg text-text-2 border-border-strong"
              }`}
            >
              {CLASS_EMOJI[c]} {c} {selected.has(c) ? "×" : ""}
            </button>
          ))}
        </div>
      </div>

      {!plan ? (
        <div className="text-center text-text-3 py-6">{loading ? "计算中…" : "无数据"}</div>
      ) : (
        <>
          {applied && (
            <div className="bg-ok-soft text-ok px-3 py-2 rounded-md mb-3 text-[13px]">
              ✓ 已改名 {applied.renamed} 个{applied.failed > 0 && `,失败 ${applied.failed}`}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
            <div className="bg-bg-soft px-3 py-2 rounded">将改名: <b>{plan.toRenameCount}</b></div>
            <div className="bg-bg-soft px-3 py-2 rounded">无需改: <b>{plan.unchangedCount}</b></div>
            <div className="bg-bg-soft px-3 py-2 rounded text-warn">读不出: <b>{plan.unreadableCount}</b></div>
          </div>
          {plan.toRenameCount > 0 && (
            <div className="border border-border rounded-md overflow-auto max-h-[360px] mb-3">
              <table className="w-full text-[12.5px]">
                <thead className="bg-bg-soft sticky top-0">
                  <tr className="text-left text-text-2">
                    <th className="px-2 py-1.5">原文件名</th>
                    <th className="px-2 py-1.5">→ 新文件名</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.items.filter((i) => !i.unchanged && !i.unreadable).map((i) => (
                    <tr key={i.path} className="border-b border-bg-soft2">
                      <td className="px-2 py-1.5 truncate max-w-[200px]" title={i.oldName}>{i.oldName}</td>
                      <td className="px-2 py-1.5 text-brand-strong truncate max-w-[200px]" title={i.newName}>{i.newName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button variant="primary" onClick={run} disabled={loading || plan.toRenameCount === 0}>
            {loading ? "执行中…" : `✓ 执行(改名 ${plan.toRenameCount} 个)`}
          </Button>
        </>
      )}
    </Card>
  );
}

// ---- 目录浏览 ----
function BrowseMode({ downloadsDir }: { downloadsDir: string }) {
  const [dir, setDir] = useState(downloadsDir);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setEntries(await listDir(dir));
    } catch (e) {
      toast(`读取失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  async function pickDir() {
    const d = await open({ directory: true, defaultPath: dir });
    if (typeof d === "string") setDir(d);
  }

  async function into(name: string) {
    setDir(await (await import("@tauri-apps/api/path")).join(dir, name));
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <input className="flex-1 px-2.5 py-1.5 border border-border-strong rounded-md text-[13px] font-mono" value={dir} onChange={(e) => setDir(e.target.value)} />
        <Button onClick={pickDir}>浏览…</Button>
        <Button variant="ghost" onClick={load}>↻</Button>
      </div>
      <div className="border border-border rounded-md overflow-auto max-h-[480px]">
        <table className="w-full text-[13px]">
          <thead className="bg-bg-soft sticky top-0">
            <tr className="text-left text-text-2">
              <th className="px-3 py-2">名称</th>
              <th className="px-3 py-2">类型</th>
              <th className="px-3 py-2">大小</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-bg-soft2 cursor-pointer hover:bg-bg-soft" onClick={() => setDir(dir.split("/").slice(0, -1).join("/") || "/")}>
              <td className="px-3 py-1.5">📁 ..</td>
              <td className="px-3 py-1.5 text-text-2 text-xs">上级</td>
              <td className="px-3 py-1.5">—</td>
            </tr>
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-text-3">读取中…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-text-3">空目录</td></tr>
            ) : (
              entries.map((e) => (
                <tr
                  key={e.path}
                  className={`border-b border-bg-soft2 ${e.is_dir ? "cursor-pointer hover:bg-bg-soft" : ""}`}
                  onClick={() => e.is_dir && into(e.name)}
                >
                  <td className="px-3 py-1.5">{e.is_dir ? "📁" : "🎵"} {e.name}</td>
                  <td className="px-3 py-1.5 text-text-2 text-xs">{e.is_dir ? "目录" : e.name.split(".").pop()?.toUpperCase()}</td>
                  <td className="px-3 py-1.5 text-text-2 text-xs">{e.is_dir ? "—" : e.size ? `${(e.size / 1024 / 1024).toFixed(1)} MB` : "?"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[11.5px] text-text-3 mt-2">点目录进入,点「..」返回上级</div>
    </Card>
  );
}
