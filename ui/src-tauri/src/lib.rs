// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod process;

// 命令需 pub 才能被 generate_handler! 宏引用
use process::{cancel_task, probe_binary, run_command};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_command,
            cancel_task,
            probe_binary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
