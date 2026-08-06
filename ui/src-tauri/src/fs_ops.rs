//! 文件系统操作:移动/改名/复制/删除/目录浏览。
//!
//! 对应 Python `organize_by_check.py` / `rename_by_metadata.py` 的文件操作部分。
//! 业务逻辑(分类判定、新旧名计算)在 TS 侧,这里只做纯文件操作。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct DirEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

/// 浏览目录(一层)。对应目录树展示。
#[tauri::command]
pub fn list_dir(dir: String) -> Vec<DirEntry> {
    let root = Path::new(&dir);
    let Ok(rd) = fs::read_dir(root) else {
        return vec![];
    };
    let mut entries: Vec<DirEntry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            let is_dir = path.is_dir();
            let size = if is_dir {
                None
            } else {
                e.metadata().ok().map(|m| m.len())
            };
            Some(DirEntry {
                path: path.to_string_lossy().to_string(),
                name,
                is_dir,
                size,
            })
        })
        .collect();
    // 目录优先,再按名字
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    entries
}

/// 移动文件(跨目录)。目标父目录自动创建。
#[tauri::command]
pub fn move_file(src: String, dst: String) -> Result<(), String> {
    let src = Path::new(&src);
    let dst = Path::new(&dst);
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::rename(src, dst).map_err(|e| format!("移动失败: {e}"))
}

/// 复制文件(保留元数据)。
#[tauri::command]
pub fn copy_file(src: String, dst: String) -> Result<(), String> {
    let src = Path::new(&src);
    let dst = Path::new(&dst);
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::copy(src, dst).map_err(|e| format!("复制失败: {e}"))?;
    Ok(())
}

/// 重命名(同目录)。文件名冲突时返回错误,由 TS 侧决定加后缀。
#[tauri::command]
pub fn rename_file(src: String, new_name: String) -> Result<String, String> {
    let src = Path::new(&src);
    let parent = src.parent().ok_or("无法获取父目录")?;
    let dst = parent.join(&new_name);
    if dst.exists() {
        return Err(format!("目标已存在: {}", dst.display()));
    }
    fs::rename(src, &dst).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(dst.to_string_lossy().to_string())
}

/// 删除文件(进废纸篓优先,失败则直接删)。
/// macOS 用 trash crate 更友好,但避免依赖;这里先直接删。
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))
}

/// 检查路径是否存在。
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 拼接路径(跨平台分隔符)。
#[tauri::command]
pub fn join_path(base: String, name: String) -> String {
    PathBuf::from(base).join(name).to_string_lossy().to_string()
}
