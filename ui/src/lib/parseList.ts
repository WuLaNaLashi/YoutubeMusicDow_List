/**
 * 歌单解析。移植自 `src/parse_list.py`。
 *
 * 格式:每行 `歌名-艺人`,分隔符是最后一个 `-`(因为有些歌名含 `-`)。
 * 多艺人用 ` _ `(空格-下划线-空格)分隔。
 */

export interface Song {
  title: string;
  artists: string[];
  raw: string;
}

/** 解析一行。空行/无效行返回 null。 */
export function parseLine(line: string): Song | null {
  const s = line.trim();
  if (!s) return null;

  const idx = s.lastIndexOf("-");
  if (idx === -1) {
    // 整行是标题,无艺人
    return { title: s, artists: [], raw: s };
  }

  const title = s.slice(0, idx).trim();
  const artistStr = s.slice(idx + 1).trim();

  if (!title) return null;

  const artists: string[] = artistStr
    ? artistStr
        .split("_")
        .map((a) => a.trim())
        .filter(Boolean)
    : [];

  return { title, artists, raw: s };
}

/** 读整份歌单文本,解析 + 去重。对应 `parse_list.load_songs`。 */
export function loadSongs(text: string): Song[] {
  const rawSongs: Song[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) rawSongs.push(parsed);
  }

  // 按归一化标题索引,做软去重
  const byNormTitle = new Map<string, Song[]>();
  for (const s of rawSongs) {
    const key = normalizeKey(s.title);
    const arr = byNormTitle.get(key) ?? [];
    arr.push(s);
    byNormTitle.set(key, arr);
  }

  const deduped: Song[] = [];
  const seen = new Set<string>();

  for (const s of rawSongs) {
    const tNorm = normalizeKey(s.title);
    const aNorm = s.artists.map(normalizeKey).join("|");
    const fullKey = `${tNorm}::${aNorm}`;
    if (seen.has(fullKey)) continue;

    // 软去重:存在 (title, []) 且另有 (title, [artist]) 时,丢前者
    if (s.artists.length === 0) {
      const siblings = byNormTitle.get(tNorm) ?? [];
      if (siblings.some((x) => x.artists.length > 0)) continue;
    }

    seen.add(fullKey);
    deduped.push(s);
  }

  return deduped;
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s\W_]+/g, "");
}

/** 构造搜索查询串。 */
export function buildSearchQuery(song: Song): string {
  return [song.title, ...song.artists].join(" ");
}
