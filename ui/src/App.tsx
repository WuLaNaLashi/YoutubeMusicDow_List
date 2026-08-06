/**
 * 应用主框架。侧栏导航 + 顶栏 + 页面切换。
 * 当前只有 Download 页实现,其余占位(后续阶段补)。
 */
import { useState, type ReactNode } from "react";
import DownloadPage from "./pages/DownloadPage";
import ReviewPage from "./pages/ReviewPage";
import OrganizePage from "./pages/OrganizePage";
import CatalogPage from "./pages/CatalogPage";
import UrlsPage from "./pages/UrlsPage";

type PageId =
  | "dashboard"
  | "review"
  | "organize"
  | "catalog"
  | "urls"
  | "tools"
  | "settings"
  | "help";

const PAGE_META: Record<PageId, [string, string, string]> = {
  dashboard: ["下载", "从歌单批量下载 YouTube Music 音频", "⬇️"],
  review: ["匹配校验", "对比请求 vs 实际内容,8 级分类", "🔍"],
  organize: ["文件整理", "按分类挪文件 / 按元数据改名", "🗂️"],
  catalog: ["来源识别", "区分正版编录 vs 普通视频 fallback", "📋"],
  urls: ["URL 直下", "用 YouTube URL 跳过搜索直接下载", "🔗"],
  tools: ["转码 & 改名", "opus→mp3 / 随机播放改名", "🛠️"],
  settings: ["设置", "Cookies / 网络 / 过滤 / 路径", "⚙️"],
  help: ["帮助中心", "使用说明 / FAQ / 故障排查", "❓"],
};

const NAV: { section: string; items: { id: PageId }[] }[] = [
  { section: "工作流", items: [{ id: "dashboard" }, { id: "review" }, { id: "organize" }, { id: "catalog" }] },
  { section: "其他", items: [{ id: "urls" }, { id: "tools" }, { id: "settings" }, { id: "help" }] },
];

function Placeholder({ page }: { page: PageId }) {
  const [, , icon] = PAGE_META[page];
  return (
    <div className="bg-bg border border-border rounded-lg p-10 text-center text-text-3">
      <div className="text-4xl mb-3">{icon}</div>
      <div>该页面将在后续阶段实现(见 docs/ui/05-development-plan.md)</div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard");

  let content: ReactNode;
  if (page === "dashboard") content = <DownloadPage />;
  else if (page === "review") content = <ReviewPage />;
  else if (page === "organize") content = <OrganizePage />;
  else if (page === "catalog") content = <CatalogPage />;
  else if (page === "urls") content = <UrlsPage />;
  else content = <Placeholder page={page} />;

  const [title, sub] = PAGE_META[page];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[220px] bg-bg border-r border-border flex flex-col flex-shrink-0">
        <div className="px-[18px] py-4 flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-[15px]"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            YT
          </div>
          <div>
            <div className="font-semibold text-[15px]">YT_Music</div>
            <div className="text-[11px] text-text-3">批量下载工具箱</div>
          </div>
        </div>
        <nav className="flex-1 px-2.5 py-2 overflow-y-auto">
          {NAV.map((g) => (
            <div key={g.section}>
              <div className="text-[11px] text-text-3 px-2.5 pt-3.5 pb-1.5 uppercase tracking-[0.06em]">
                {g.section}
              </div>
              {g.items.map(({ id }) => {
                const [label, , icon] = PAGE_META[id];
                return (
                  <div
                    key={id}
                    onClick={() => setPage(id)}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13.5px] mb-px cursor-pointer transition-all ${
                      page === id
                        ? "bg-brand-soft text-brand-strong font-medium"
                        : "text-text-2 hover:bg-bg-soft2 hover:text-text"
                    }`}
                  >
                    <span className="w-[17px] text-center text-[15px]">{icon}</span>
                    {label}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-border text-[11px] text-text-3">
          <span className="inline-block w-[7px] h-[7px] rounded-full bg-ok mr-1.5" />
          后端已连接
          <br />
          <span className="opacity-70">v0.1.0 · Tauri</span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-[52px] bg-bg border-b border-border flex items-center px-5 gap-3 flex-shrink-0">
          <div>
            <h1 className="text-[15px] font-semibold">{title}</h1>
            <div className="text-text-3 text-xs">{sub}</div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-xs text-text-2 px-2.5 py-1 bg-bg-soft2 rounded-md">
            <span style={{ color: "var(--color-ok)" }}>●</span> ffmpeg 7.1
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 pb-10 animate-fade">{content}</div>
      </div>
    </div>
  );
}
