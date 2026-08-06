/**
 * Tauri 后端命令与事件封装。
 *
 * 后端命令(见 src-tauri/src/process.rs):
 *   - run_command(program, args, cwd?, event_name) -> task_id
 *   - cancel_task(task_id) -> bool
 *   - probe_binary(bin) -> string | null
 *
 * run_command 会发三类事件(事件名 = event_name + 后缀):
 *   - {event_name}        : { task_id, stream: "stdout"|"stderr", line }
 *   - {event_name}_start  : { task_id, pid }
 *   - {event_name}_done   : { task_id, success, code }
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface LineEvent {
  task_id: number;
  stream: "stdout" | "stderr";
  line: string;
}
export interface DoneEvent {
  task_id: number;
  success: boolean;
  code: number | null;
}
export interface StartEvent {
  task_id: number;
  pid: number;
}

/** 启动一个子进程,流式推输出。返回 task_id。
 *
 * opts.injectProxy:为 true 时,子进程自动继承探测到的系统代理(env > 系统设置),
 * yt-dlp/ffmpeg 会通过 HTTP_PROXY 等环境变量读到。默认 false(因为下载用 --proxy 显式传更稳)。
 */
export function runCommand(
  program: string,
  args: string[],
  opts: { cwd?: string; event: string; injectProxy?: boolean },
): Promise<number> {
  return invoke<number>("run_command", {
    program,
    args,
    cwd: opts.cwd ?? null,
    eventName: opts.event,
    injectProxy: opts.injectProxy ?? false,
  });
}

/** 取消任务。 */
export function cancelTask(taskId: number): Promise<boolean> {
  return invoke<boolean>("cancel_task", { taskId });
}

/** 探测二进制是否存在。 */
export function probeBinary(bin: string): Promise<string | null> {
  return invoke<string | null>("probe_binary", { bin });
}

/** 探测系统级代理设置(macOS scutil / Windows 注册表 / Linux gsettings)。返回 URL 或 null。 */
export function detectSystemProxy(): Promise<string | null> {
  return invoke<string | null>("detect_system_proxy_cmd");
}

/** 解析最终生效代理(env > 系统设置)。返回 URL 或 null。 */
export function resolveProxy(): Promise<string | null> {
  return invoke<string | null>("resolve_proxy_cmd");
}

/** 监听某一行的输出事件。返回取消监听函数。 */
export function onLine(
  event: string,
  handler: (e: LineEvent) => void,
): Promise<UnlistenFn> {
  return listen<LineEvent>(event, (e) => handler(e.payload));
}

/** 监听结束事件。 */
export function onDone(
  event: string,
  handler: (e: DoneEvent) => void,
): Promise<UnlistenFn> {
  return listen<DoneEvent>(`${event}_done`, (e) => handler(e.payload));
}

/** 监听启动事件。 */
export function onStart(
  event: string,
  handler: (e: StartEvent) => void,
): Promise<UnlistenFn> {
  return listen<StartEvent>(`${event}_start`, (e) => handler(e.payload));
}
