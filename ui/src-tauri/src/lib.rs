// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod fs_ops;
mod metadata;
mod process;
mod proxy;

// 命令需 pub 才能被 generate_handler! 宏引用
use fs_ops::{
    copy_file, delete_file, join_path, list_dir, move_file, path_exists, rename_file,
};
use metadata::{read_audio_meta, scan_audio_dir};
use process::{cancel_task, probe_binary, run_command};
use proxy::{detect_system_proxy_cmd, resolve_proxy_cmd};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // process
            run_command,
            cancel_task,
            probe_binary,
            // proxy
            detect_system_proxy_cmd,
            resolve_proxy_cmd,
            // metadata
            read_audio_meta,
            scan_audio_dir,
            // fs_ops
            list_dir,
            move_file,
            copy_file,
            rename_file,
            delete_file,
            path_exists,
            join_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
