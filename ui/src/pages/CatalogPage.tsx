/**
 * 来源识别页(C)。对应需求 §3.4 C-1/C-2。
 *
 * 扫描 downloads/ 下所有音频,用 lofty 读 synopsis 判断:
 *   - 含「Provided to YouTube by」→ catalog(正版编录)
 *   - 是编录但 album 空 → catalog_no_album
 *   - 否则 → non_catalog(普通视频 / fallback)
 *
 * 展示三类统计 + non_catalog 明细(可跳 YT 核对)。
 */
import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Card, Stat, Tag, toast } from "../components/ui";
import { scanAudioDir, type ScanItem, type SourceClass } from "../api/tauri";
import { useDownloadStore } from "../stores/downloadStore";

const SOURCE_LABEL: Record<SourceClass, string> = {
  catalog: "catalog 正版编录",
  catalog_no_album: "catalog_no_album 编录缺 album",
  non_catalog: "non_catalog 普通视频",
  unreadable: "unreadable 读不出",
};

export default function CatalogPage() {
  const [items, setItems] = useState<ScanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeNoAlbum, setIncludeNoAlbum] = useState(false);
  const [filter, setFilter] = useState<SourceClass | "all">("all");

  const rowsFromStore = useDownloadStore((s) => s.rows);
  const downloadsDir = useMemo(() => {
    const fp = rowsFromStore[0]?.filepath;
    if (!fp) return "downloads";
    const idx = fp.lastIndexOf("/downloads/");
    return idx > 0 ? fp.slice(0, idx + 10) : "downloads";
  }, [rowsFromStore]);

  async function scan() {
    setLoading(true);
    try {
      const r = await scanAudioDir(downloadsDir, true);
      setItems(r);
      toast(`扫描完成,共 ${r.length} 个文件`);
    } catch (e) {
      toast(`扫描失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c: Record<SourceClass, number> = {
      catalog: 0,
      catalog_no_album: 0,
      non_catalog: 0,
      unreadable: 0,
    };
    for (const it of items) c[it.source]++;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "all") {
      // 默认重点看 non_catalog + (可选)catalog_no_album
      return items.filter((i) =>
        includeNoAlbum
          ? i.source === "non_catalog" || i.source === "catalog_no_album"
          : i.source === "non_catalog",
      );
    }
    return items.filter((i) => i.source === filter);
  }, [items, filter, includeNoAlbum]);

  async function openYt(videoId: string | null) {
    if (!videoId) {
      toast("无 videoId(synopsis/purl 缺失)");
      return;
    }
    try {
      await openUrl(`https://music.youtube.com/watch?v=${videoId}`);
    } catch (e) {
      toast(`打开失败: ${e}`);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-[15px] font-semibold mb-0.5">来源识别</h3>
            <div className="text-text-3 text-xs">
              通过「Provided to YouTube by」签名区分正版编录 vs 普通视频 fallback · 扫描 {downloadsDir}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeNoAlbum}
                onChange={(e) => setIncludeNoAlbum(e.target.checked)}
                className="accent-brand"
              />
              含编录缺 album
            </label>
            <Button variant="primary" onClick={scan} disabled={loading}>
              {loading ? "扫描中…" : "▶️ 重新扫描"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        <button onClick={() => setFilter(filter === "catalog" ? "all" : "catalog")} className="text-left">
          <Stat num={counts.catalog} label="✅ catalog 正版编录" numColor="var(--color-ok)" />
        </button>
        <button onClick={() => setFilter(filter === "catalog_no_album" ? "all" : "catalog_no_album")} className="text-left">
          <Stat num={counts.catalog_no_album} label="🟡 catalog_no_album" numColor="var(--color-warn)" />
        </button>
        <button onClick={() => setFilter(filter === "non_catalog" ? "all" : "non_catalog")} className="text-left">
          <Stat num={counts.non_catalog} label="❌ non_catalog 普通视频" numColor="var(--color-err)" />
        </button>
        {counts.unreadable > 0 && (
          <button onClick={() => setFilter(filter === "unreadable" ? "all" : "unreadable")} className="text-left">
            <Stat num={counts.unreadable} label="⚠️ 读不出元数据" numColor="var(--color-warn)" />
          </button>
        )}
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">
            {filter === "all" ? "❌ 非/缺编录明细(优先 review)" : `${SOURCE_LABEL[filter]} 明细`} · 共 {filtered.length} 条
            {filter !== "all" && (
              <button className="ml-2 text-xs text-brand hover:underline" onClick={() => setFilter("all")}>
                清除筛选
              </button>
            )}
          </h3>
        </div>
        {filtered.length === 0 ? (
          <div className="text-center text-text-3 py-6">
            {loading ? "扫描中…" : items.length === 0 ? "暂无数据(先去 D 页下载几首)" : "✅ 没有" + (filter === "all" ? "非编录" : SOURCE_LABEL[filter]) + "条目"}
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-auto max-h-[520px]">
            <table className="w-full text-[13px]">
              <thead className="bg-bg-soft sticky top-0">
                <tr className="text-left text-text-2 text-xs">
                  <th className="px-3 py-2">文件</th>
                  <th className="px-3 py-2">标题 / 艺人</th>
                  <th className="px-3 py-2">videoId</th>
                  <th className="px-3 py-2">来源</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.path} className="border-b border-bg-soft2 hover:bg-bg-soft">
                    <td className="px-3 py-2 truncate max-w-[220px]" title={it.path}>{it.filename}</td>
                    <td className="px-3 py-2">
                      <div className="text-[12.5px]">{it.meta?.title ?? "—"}</div>
                      <div className="text-text-2 text-xs">{it.meta?.artist ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-2">{it.video_id ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Tag
                        color={
                          it.source === "catalog"
                            ? "ok"
                            : it.source === "non_catalog"
                              ? "err"
                              : it.source === "unreadable"
                                ? "neutral"
                                : "warn"
                        }
                      >
                        {it.source}
                      </Tag>
                    </td>
                    <td className="px-3 py-2">
                      <Button className="!px-2 !py-0.5 !text-[12px]" onClick={() => openYt(it.video_id)}>
                        ↗ YT
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
