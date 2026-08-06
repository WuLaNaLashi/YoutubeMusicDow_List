/**
 * 帮助中心页(H)。对应需求 §3.8 H-1~H-8。
 *
 * 把原型的帮助内容搬进应用:快速上手、分类体系、FAQ、排错、已知限制。
 * 让用户不离开应用就能学会用、能自助排错。
 */
import { useState } from "react";
import { Card, Tag } from "../components/ui";

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "中国大陆能用吗?",
    a: (
      <>
        能。应用会<b>自动探测系统代理</b>(macOS 系统设置/Windows 注册表/Linux gsettings),
        如果你开了 Clash/Surge 的「系统代理」模式,直接就能用,无需在 UI 里再填。
        也可以在「设置 → 网络」手动填代理覆盖。境内必需能访问 YouTube。
      </>
    ),
  },
  {
    q: "报错 Requested format is not available",
    a: (
      <>
        这是 yt-dlp 缺少 JS 运行时导致 YouTube 挑战失败。装 deno:
        <code className="bg-bg-soft2 px-1 rounded mx-1">curl -fsSL https://deno.land/install.sh | sh</code>
        装完在「设置 → 环境自检」确认。
      </>
    ),
  },
  {
    q: "下载到的歌不对(mismatch)",
    a: (
      <>
        YouTube 搜索返回了翻唱/MV/medley 等非目标版本。去「匹配校验」页,
        重点 review <Tag color="err">❌ mismatch</Tag> 和 <Tag color="warn">⚠ warn_title_diff</Tag>,
        点「↻ 重下」会重置该首,回「下载」页点「全量下载」会自动重跑这条。
      </>
    ),
  },
  {
    q: "下载结果能不能 100% 准确?",
    a: (
      <>
        不能。底层依赖 YouTube 搜索,会有少量下错。实测(1106 首):完美匹配约 66%、
        艺人别名疑似 27%、需 review 6%、真不匹配 1.3%。所以<b>跑完务必去「匹配校验」页 review</b>。
      </>
    ),
  },
  {
    q: "想要 mp3 而不是 opus?",
    a: (
      <>
        默认保留原始流(opus,音质更好)。如设备不支持 opus,去「转码 & 改名」页转 mp3(320k)。
        ⚠ opus→mp3 是有损→有损,有音质损失。
      </>
    ),
  },
  {
    q: "怎么强制重下某首歌?",
    a: (
      <>
        在「匹配校验」页找到那首,点「↻ 重下」会重置为待下载状态,然后回「下载」页
        点「全量下载」,该首会自动重跑(其余已完成的跳过)。
      </>
    ),
  },
  {
    q: "不知道下的是不是正版?",
    a: (
      <>
        去「来源识别」页扫描,它会读音频里的「Provided to YouTube by」签名:
        <Tag color="ok" className="mx-1">catalog</Tag>正版编录 ·
        <Tag color="err" className="mx-1">non_catalog</Tag>普通视频/翻唱(需 review)。
      </>
    ),
  },
  {
    q: "界面卡顿/不跟手?",
    a: (
      <>
        已知大歌单(几百首以上)明细表会限 200 条渲染。歌单输入有 300ms 防抖。
        若仍卡,切到具体状态筛选(如「待确认」)减少渲染量。
      </>
    ),
  },
];

const CLASSES = [
  ["ok", "✅", "艺人+标题都对", "artist=exact, title_sim ≥ 0.55"],
  ["ok_no_artist", "🟡", "歌单原始缺艺人,只能按标题判断", "requested 为空, sim ≥ 0.7"],
  ["warn_alias_likely", "🔵", "艺人字面不同但标题完全一致(罗马音/艺名,如 米津玄师↔Kenshi Yonezu)", "astat=none, sim ≥ 0.92"],
  ["warn_title_diff", "⚠️", "艺人对但标题差异大", "astat=exact, sim<0.55"],
  ["warn_partial_artist", "⚠️", "艺人字符仅部分相交", "astat=partial"],
  ["warn_no_artist", "⚠️", "YT 返回的艺人为空", "astat=no_matched"],
  ["warn_title_only", "⚠️", "歌单缺艺人且标题也差", "requested 为空, sim<0.7"],
  ["mismatch", "❌", "艺人不同+标题也明显不同,需重下", "astat=none, sim<0.92"],
] as const;

const LIMITS = [
  "歌单数据反向:部分条目艺人写在前歌名在后,YT 搜索容错通常能救,但 metadata 会反。",
  "含 - 的艺人名(A-Lin、F.I.R.):解析器会切错,YT 容错常能救。",
  "单字标题(溯、哇):子串检测被跳过,落到 mismatch,需人工 review。",
  "跨语言同曲(金达莱花↔Azalea):同首歌但无法自动识别,落到 warn_title_diff。",
  "特定版本:用户写「DJ 阿卓版」但 YT Music 没有,只下到普通版。",
  "音质上限受账号影响:无 Premium 上限是 opus ~160 kbps。",
];

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="space-y-4 max-w-[860px]">
      {/* 快速上手 */}
      <Card>
        <h3 className="text-[15px] font-semibold mb-3">⚡ 快速上手(4 步)</h3>
        <div className="space-y-2.5">
          {[
            ["配代理", "境内用户开 Clash/Surge 系统代理即可(应用自动探测);或「设置→网络」手填。"],
            ["导入歌单", "「下载」页文本框填(每行 歌名-艺人),或点「导入 txt」。"],
            ["测试 5 首", "点「▶️ 开始下载」→「🎲 测试 5 首」验证环境。"],
            ["全量 + 校验", "点「全量下载」→ 跑完去「匹配校验」review ❌ mismatch。"],
          ].map(([t, d], i) => (
            <div key={i} className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center text-[13px] font-semibold">
                {i + 1}
              </div>
              <div className="text-[13px] text-text-2 pt-0.5">
                <b className="text-text">{t}</b> — {d}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 分类体系 */}
      <Card>
        <h3 className="text-[15px] font-semibold mb-1">匹配分类体系</h3>
        <div className="text-text-3 text-xs mb-3">「匹配校验」页把每首歌按以下规则归类。橙色行需重点 review。</div>
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-bg-soft">
              <tr className="text-left text-text-2 text-xs">
                <th className="px-3 py-2">标签</th>
                <th className="px-3 py-2">含义</th>
                <th className="px-3 py-2">触发条件</th>
              </tr>
            </thead>
            <tbody>
              {CLASSES.map(([c, emoji, mean, cond]) => (
                <tr
                  key={c}
                  className="border-b border-bg-soft2"
                  style={{
                    background:
                      c === "mismatch"
                        ? "var(--color-err-soft)"
                        : c.startsWith("warn_")
                          ? "var(--color-warn-soft)"
                          : undefined,
                  }}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{emoji} {c}</td>
                  <td className="px-3 py-2">{mean}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-2">{cond}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* FAQ */}
      <Card>
        <h3 className="text-[15px] font-semibold mb-3">常见问题</h3>
        <div className="space-y-1.5">
          {FAQS.map((f, i) => (
            <div key={i} className="border border-border rounded-md overflow-hidden">
              <button
                className="w-full px-3 py-2.5 flex justify-between items-center text-left text-[13px] font-medium hover:bg-bg-soft"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                {f.q}
                <span className={`text-text-3 transition-transform ${openFaq === i ? "rotate-90" : ""}`}>▸</span>
              </button>
              {openFaq === i && (
                <div className="px-3 pb-3 text-[13px] text-text-2 leading-relaxed">{f.a}</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* 排错 */}
      <Card>
        <h3 className="text-[15px] font-semibold mb-3">故障排查</h3>
        <div className="text-[13px] text-text-2 space-y-2 mb-3">
          <div>
            ① 去 <b>「设置 → 环境自检」</b> 看 yt-dlp/ffmpeg/deno 是否齐。缺啥装啥:
          </div>
          <pre className="bg-[#0f172a] text-[#e2e8f0] p-3 rounded-md text-[12px] overflow-x-auto">{`# macOS
brew install ffmpeg yt-dlp
curl -fsSL https://deno.land/install.sh | sh

# Linux
sudo apt install ffmpeg
pipx install yt-dlp`}</pre>
          <div>② 去 <b>「设置 → 网络」</b> 看代理是否生效,点「测试连通 YouTube」。</div>
          <div>③ 看应用底部日志面板(yt-dlp 报错以黄色显示)。</div>
        </div>
      </Card>

      {/* 已知限制 */}
      <Card>
        <h3 className="text-[15px] font-semibold mb-3">已知限制(坦白告知)</h3>
        <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-text-2">
          {LIMITS.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </Card>

      <div className="text-center text-text-3 text-xs py-2">
        YT_Music UI v0.1 · Tauri + React + TS · 仅供个人学习使用
      </div>
    </div>
  );
}
