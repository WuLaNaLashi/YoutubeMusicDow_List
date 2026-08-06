/**
 * 下载任务状态管理(Zustand)。
 *
 * 维护歌单 + 每首歌的运行时状态(待下载/搜索中/下载中/完成/失败/待确认/跳过),
 * 以及整体进度。D 页 UI 订阅这个 store。
 */
import { create } from "zustand";
import type { Song } from "../lib/parseList";
import type { SearchResult } from "../lib/pickBest";
import type { Confidence } from "../lib/confidence";

export type RowState =
  | "todo"
  | "searching"
  | "downloading"
  | "done"
  | "failed"
  | "pending"
  | "skipped";

export interface Row {
  song: Song;
  state: RowState;
  /** 实际匹配到的(搜索后) */
  match: SearchResult | null;
  /** 置信度(搜索后) */
  confidence: Confidence | null;
  /** 存疑原因 */
  reason: string | null;
  /** 命中标签 */
  flags: string[];
  /** 失败原因(failed 时) */
  failReason: string | null;
  /** 输出文件路径(done 时) */
  filepath: string | null;
}

export interface LogEntry {
  level: "info" | "warn" | "err" | "ok";
  msg: string;
  time: number;
}

interface DownloadState {
  rows: Row[];
  isRunning: boolean;
  /** 已完成的索引序号(用于串行推进) */
  cursor: number;
  logs: LogEntry[];

  setSongs: (songs: Song[]) => void;
  updateRow: (idx: number, patch: Partial<Row>) => void;
  setRunning: (r: boolean) => void;
  setCursor: (c: number) => void;
  log: (level: LogEntry["level"], msg: string) => void;
  clearLogs: () => void;
  reset: () => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  rows: [],
  isRunning: false,
  cursor: 0,
  logs: [],

  setSongs: (songs) =>
    set({
      rows: songs.map((song) => ({
        song,
        state: "todo" as RowState,
        match: null,
        confidence: null,
        reason: null,
        flags: [],
        failReason: null,
        filepath: null,
      })),
      cursor: 0,
      logs: [],
    }),

  updateRow: (idx, patch) =>
    set((s) => {
      const rows = [...s.rows];
      if (rows[idx]) rows[idx] = { ...rows[idx], ...patch };
      return { rows };
    }),

  setRunning: (r) => set({ isRunning: r }),
  setCursor: (c) => set({ cursor: c }),
  log: (level, msg) =>
    set((s) => ({
      logs: [...s.logs, { level, msg, time: Date.now() }].slice(-500),
    })),
  clearLogs: () => set({ logs: [] }),
  reset: () => set({ rows: [], cursor: 0, isRunning: false, logs: [] }),
}));
