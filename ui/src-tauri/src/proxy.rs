//! 系统代理探测。
//!
//! 为什么需要这个:yt-dlp / ffmpeg 作为子进程启动时,
//! 默认既不读 macOS/Windows 的"系统全局代理"设置,也未必继承 shell 的环境变量。
//! Clash/V2Ray 的"系统代理"模式改的是系统设置,子进程看不见。
//!
//! 本模块探测系统代理,供 run_command 注入到子进程的环境变量,
//! 让"系统代理开着就能直接用"。
//!
//! 优先级(见 resolve_proxy):
//!   1. 环境变量 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY
//!   2. 系统代理设置(macOS scutil / Windows 注册表 / Linux gsettings)

use std::collections::HashMap;

/// 探测系统级代理设置,返回形如 "http://127.0.0.1:7890" 的 URL;无则 None。
///
/// 平台实现:
/// - macOS: `scutil --proxy` 输出里有 Enable/HTTPEnable/HTTPProxy/HTTPPort 等
/// - Windows: 注册表 HKCU\...\Internet Settings\ProxyEnable / ProxyServer
/// - Linux: `gsettings get org.gnome.system.proxy mode/http/host/port`
#[cfg(target_os = "macos")]
pub fn detect_system_proxy() -> Option<String> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_scutil(&text)
}

#[cfg(target_os = "macos")]
fn parse_scutil(text: &str) -> Option<String> {
    // scutil --proxy 输出示例:
    //   Enable : 1
    //   HTTPEnable : 1
    //   HTTPPort : 7890
    //   HTTPProxy : 127.0.0.1
    //   HTTPSEnable : 1
    //   HTTPSPort : 7890
    //   HTTPSProxy : 127.0.0.1
    //   SOCKSEnable : 1
    //   SOCKSPort : 7890
    //   SOCKSProxy : 127.0.0.1
    let map: HashMap<&str, &str> = text
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let (k, v) = line.split_once(':')?;
            Some((k.trim(), v.trim()))
        })
        .collect();

    let enabled = map.get("Enable").map(|v| *v == "1").unwrap_or(false);
    if !enabled {
        // 有些情况下只有 HTTPEnable,没有总 Enable;放宽判断
        let any_enabled = ["HTTPEnable", "HTTPSEnable", "SOCKSEnable"]
            .iter()
            .any(|k| map.get(*k).map(|v| *v == "1").unwrap_or(false));
        if !any_enabled {
            return None;
        }
    }

    // 优先 HTTP,其次 HTTPS,最后 SOCKS
    if let (Some(host), Some(port)) = (map.get("HTTPProxy"), map.get("HTTPPort")) {
        return Some(format!("http://{}:{}", host, port));
    }
    if let (Some(host), Some(port)) = (map.get("HTTPSProxy"), map.get("HTTPSPort")) {
        return Some(format!("http://{}:{}", host, port));
    }
    if let (Some(host), Some(port)) = (map.get("SOCKSProxy"), map.get("SOCKSPort")) {
        return Some(format!("socks5://{}:{}", host, port));
    }
    None
}

#[cfg(target_os = "windows")]
pub fn detect_system_proxy() -> Option<String> {
    // 用 reg query(系统自带),避免引入 winreg crate 依赖
    // 查 ProxyEnable
    let enable_out = std::process::Command::new("reg")
        .args([
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            "/v",
            "ProxyEnable",
        ])
        .output()
        .ok()?;
    let enable_text = String::from_utf8_lossy(&enable_out.stdout);
    let enabled = enable_text
        .lines()
        .find_map(|l| l.trim().strip_prefix("ProxyEnable"))
        .map(|rest| rest.trim_start().trim().contains("0x1"))
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    // 查 ProxyServer
    let server_out = std::process::Command::new("reg")
        .args([
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            "/v",
            "ProxyServer",
        ])
        .output()
        .ok()?;
    let server_text = String::from_utf8_lossy(&server_out.stdout);
    let server = server_text
        .lines()
        .find_map(|l| {
            let l = l.trim();
            l.strip_prefix("ProxyServer").map(|rest| {
                // 形如 "    REG_SZ    host:port"
                rest.trim_start()
                    .trim_start_matches("REG_SZ")
                    .trim()
                    .to_string()
            })
        })?;
    // ProxyServer 可能是 "host:port" 或 "http=host:port;https=host:port"
    if server.contains('=') {
        for part in server.split(';') {
            if let Some(rest) = part
                .strip_prefix("http=")
                .or_else(|| part.strip_prefix("https="))
            {
                return Some(normalize(rest));
            }
        }
        None
    } else {
        Some(normalize(&server))
    }
}

#[cfg(target_os = "windows")]
fn normalize(addr: &str) -> String {
    if addr.starts_with("http://") || addr.starts_with("https://") || addr.starts_with("socks") {
        addr.to_string()
    } else {
        format!("http://{}", addr)
    }
}

#[cfg(target_os = "linux")]
pub fn detect_system_proxy() -> Option<String> {
    // GNOME 系:gsettings;其他桌面环境(KDE 等)暂不支持,用户需用环境变量或 UI 手填。
    let mode = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy", "mode"])
        .output()
        .ok()?;
    let mode_str = String::from_utf8_lossy(&mode.stdout).trim().trim_matches('\'').to_string();
    if mode_str != "manual" {
        return None;
    }
    let host = gsettings_get("org.gnome.system.proxy.http", "host")?;
    let port = gsettings_get("org.gnome.system.proxy.http", "port")?;
    Some(format!("http://{}:{}", host, port))
}

#[cfg(target_os = "linux")]
fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // gsettings 输出带引号('host'),去掉
    let s = s.trim_matches('\'').to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

// --- 非 mac/win/linux 的兜底(理论上 Tauri 不会跑到这) ---
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn detect_system_proxy() -> Option<String> {
    None
}

/// 读环境变量里的代理(http_proxy/https_proxy/all_proxy,大小写都试)。
pub fn env_proxy() -> Option<String> {
    for key in &[
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

/// 按优先级解析最终生效的代理:env > 系统设置。
/// 返回 None 表示"无任何代理"(直连)。
pub fn resolve_proxy() -> Option<String> {
    env_proxy().or_else(detect_system_proxy)
}

/// 探测系统代理(供前端显示"已检测到系统代理"状态)。
#[tauri::command]
pub fn detect_system_proxy_cmd() -> Option<String> {
    detect_system_proxy()
}

/// 解析最终生效代理(env > system)。
#[tauri::command]
pub fn resolve_proxy_cmd() -> Option<String> {
    resolve_proxy()
}

#[cfg(test)]
mod tests {
    use super::parse_scutil;

    const REAL_OUTPUT: &str = "<dictionary> {
  ExceptionsList : <array> {
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
}";

    #[test]
    fn parses_real_scutil_output() {
        let proxy = parse_scutil(REAL_OUTPUT).expect("应解析出代理");
        assert_eq!(proxy, "http://127.0.0.1:7897");
    }

    #[test]
    fn returns_none_when_disabled() {
        let disabled = "
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 0
";
        assert!(parse_scutil(disabled).is_none());
    }
}
