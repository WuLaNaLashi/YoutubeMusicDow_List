//! 子进程封装:spawn yt-dlp / ffmpeg,流式读 stdout/stderr,经 Tauri Event 推前端。
//!
//! 业务逻辑在 TS 侧,这里只做"跑命令 + 推进度"。
//! 命令在 lib.rs 的 generate_handler! 宏里注册。

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(1);

/// 运行中的任务:持有 child,可在取消时 start_kill。
struct RunningTask {
    child: AsyncMutex<tokio::process::Child>,
}

/// task_id -> RunningTask。外层用 std::sync::Mutex(同步、瞬时锁,不跨 await)。
static TASKS: Mutex<Option<HashMap<u64, RunningTask>>> = Mutex::new(None);

fn store_task(id: u64, task: RunningTask) {
    let mut guard = TASKS.lock().unwrap();
    guard.get_or_insert_with(HashMap::new).insert(id, task);
}

fn take_task(id: u64) -> Option<RunningTask> {
    TASKS.lock().unwrap().as_mut().and_then(|m| m.remove(&id))
}

/// 找一个二进制(yt-dlp / ffmpeg / deno / python)的可用路径。
/// 优先 PATH;找不到返回 None,前端会提示用户安装。
pub fn which(bin: &str) -> Option<std::path::PathBuf> {
    let path_env = std::env::var_os("PATH")?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    for dir in std::env::split_paths(&path_env) {
        let cand = dir.join(format!("{}{}", bin, ext));
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

#[derive(Serialize, Deserialize, Clone)]
struct LineEvent {
    task_id: u64,
    stream: String, // "stdout" | "stderr"
    line: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct DoneEvent {
    task_id: u64,
    success: bool,
    code: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone)]
struct StartEvent {
    task_id: u64,
    pid: u32,
}

/// 运行一个命令,流式把 stdout/stderr 的每一行通过事件推给前端。
///
/// - `{event_name}`       : 每行输出 `{ task_id, stream, line }`
/// - `{event_name}_start` : 启动 `{ task_id, pid }`
/// - `{event_name}_done`  : 结束 `{ task_id, success, code }`
///
/// 返回 task_id,前端可用 `cancel_task` 取消。
#[tauri::command]
pub async fn run_command(
    app: AppHandle,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    event_name: String,
) -> Result<u64, String> {
    let task_id = NEXT_TASK_ID.fetch_add(1, Ordering::SeqCst);

    let resolved = which(&program).unwrap_or_else(|| std::path::PathBuf::from(&program));

    let mut cmd = Command::new(&resolved);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 {} ({}): {}", program, resolved.display(), e))?;
    let pid = child.id().ok_or_else(|| "无法获取子进程 pid".to_string())?;

    let _ = app.emit(
        &format!("{}_start", event_name),
        StartEvent { task_id, pid },
    );

    let stdout = child.stdout.take().expect("stdout 已被取走");
    let stderr = child.stderr.take().expect("stderr 已被取走");

    store_task(task_id, RunningTask { child: AsyncMutex::new(child) });

    let app_clone = app.clone();
    let ev = event_name.clone();
    // 读 stdout + stderr,逐行推。tokio::select! 在两个流之间轮转。
    tokio::spawn(async move {
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        loop {
            tokio::select! {
                line = stdout_reader.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            let _ = app_clone.emit(
                                &ev,
                                LineEvent { task_id, stream: "stdout".into(), line },
                            );
                        }
                        _ => break,
                    }
                }
                line = stderr_reader.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            let _ = app_clone.emit(
                                &ev,
                                LineEvent { task_id, stream: "stderr".into(), line },
                            );
                        }
                        _ => break,
                    }
                }
            }
        }
    });

    // 等子进程结束,推 done
    let wait_app = app.clone();
    let wait_ev = event_name.clone();
    tokio::spawn(async move {
        // 从 TASKS 表取出 child 所有权来 wait(不再放回)
        let status = if let Some(task) = take_task(task_id) {
            let mut guard = task.child.lock().await;
            guard.wait().await
        } else {
            return;
        };
        let (success, code) = match status {
            Ok(s) => (s.success(), s.code()),
            Err(_) => (false, None),
        };
        let _ = wait_app.emit(
            &format!("{}_done", wait_ev),
            DoneEvent { task_id, success, code },
        );
    });

    Ok(task_id)
}

/// 取消一个运行中的任务(发送 kill)。
#[tauri::command]
pub async fn cancel_task(task_id: u64) -> Result<bool, String> {
    if let Some(task) = take_task(task_id) {
        let mut guard = task.child.lock().await;
        let _ = guard.start_kill();
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 探测某个二进制是否存在,返回其路径(供前端环境自检)。
#[tauri::command]
pub fn probe_binary(bin: String) -> Option<String> {
    which(&bin).map(|p| p.to_string_lossy().to_string())
}
