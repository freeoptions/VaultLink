#[cfg(mobile)]
use tauri::Manager;
#[cfg(desktop)]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

use axum::{
    extract::{ConnectInfo, State as AxumState},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo, TxtProperties};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddrV4, UdpSocket};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(mobile)]
use tauri::path::BaseDirectory;
use tauri::Emitter;
use uuid::Uuid;

#[cfg(desktop)]
fn get_app_data_path(_app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "无法读取软件所在目录".to_string())?;
    Ok(exe_dir.join(file_name))
}

#[cfg(mobile)]
fn get_app_data_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(file_name, BaseDirectory::AppData)
        .map_err(|e| e.to_string())
}

// Windows 使用 exe 同级目录；Android 使用系统应用数据目录。
fn get_storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_data_path(app, "AccountInfo.json")
}

fn get_device_id_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_data_path(app, "device_id.txt")
}

fn get_device_name_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_data_path(app, "device_name.txt")
}

fn get_backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_data_path(app, "backups")
}

static DATA_FILE_LOCK: Mutex<()> = Mutex::new(());

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(desktop)]
fn legacy_app_file_paths(file_name: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let legacy_dirs = [
        "com.freez.vaultlink",
        "VaultLink",
        "MyAccountManager",
        "com.freez.myaccountmanager",
    ];

    for env_key in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(env_key) {
            for legacy_dir in legacy_dirs {
                paths.push(PathBuf::from(&base).join(legacy_dir).join(file_name));
            }
        }
    }

    paths
}

#[cfg(desktop)]
fn legacy_app_data_paths() -> Vec<PathBuf> {
    legacy_app_file_paths("AccountInfo.json")
}

#[cfg(desktop)]
fn migrate_small_app_file(target_path: &PathBuf, file_name: &str) -> Result<bool, String> {
    if target_path.exists() {
        return Ok(false);
    }

    for source_path in legacy_app_file_paths(file_name) {
        if source_path == *target_path || !source_path.exists() {
            continue;
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(source_path, target_path).map_err(|e| e.to_string())?;
        return Ok(true);
    }

    Ok(false)
}

#[cfg(desktop)]
fn migrate_legacy_app_data(
    _app: &tauri::AppHandle,
    data_path: &PathBuf,
) -> Result<Option<String>, String> {
    for legacy_path in legacy_app_data_paths() {
        if legacy_path == *data_path || !legacy_path.exists() {
            continue;
        }

        let content = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;

        if let Some(parent) = data_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        fs::write(data_path, &content).map_err(|e| e.to_string())?;

        if let Some(parent) = legacy_path.parent() {
            let marker_path = parent.join("VaultLink.migrated.txt");
            let _ = fs::write(
                marker_path,
                "VaultLink copied AccountInfo.json from this legacy MyAccountManager data folder.",
            );
        }

        println!("Migrated legacy data from {}", legacy_path.display());
        return Ok(Some(content));
    }

    Ok(None)
}

fn backup_data_file_unlocked(
    app: &tauri::AppHandle,
    reason: &str,
) -> Result<Option<PathBuf>, String> {
    let data_path = get_storage_path(app)?;

    if !data_path.exists() {
        return Ok(None);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let backup_dir = get_backup_dir(app)?;
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let backup_path = backup_dir.join(format!("AccountInfo.{}.{}.json", reason, timestamp));
    fs::copy(&data_path, &backup_path).map_err(|e| e.to_string())?;
    Ok(Some(backup_path))
}

fn backup_data_file(app: &tauri::AppHandle, reason: &str) -> Result<Option<PathBuf>, String> {
    let _guard = DATA_FILE_LOCK.lock().map_err(|e| e.to_string())?;
    backup_data_file_unlocked(app, reason)
}

fn parse_sync_payload(content: &str) -> Result<SyncPayload, String> {
    serde_json::from_str(content).map_err(|e| e.to_string())
}

fn default_sync_payload_json() -> String {
    r#"{"accounts":[],"tags":[]}"#.to_string()
}

fn normalize_payload_content(content: String) -> Result<String, String> {
    let payload = parse_sync_payload(&content)?;
    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

fn file_sha256(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn file_updated_at(payload: &SyncPayload) -> i64 {
    let account_max = payload
        .accounts
        .iter()
        .map(|account| account.updated_at.max(account.created_at))
        .max()
        .unwrap_or(0);
    let tag_max = payload
        .tags
        .iter()
        .map(|tag| tag.updated_at.max(tag.created_at))
        .max()
        .unwrap_or(0);

    let theme_updated_at = payload
        .theme
        .as_ref()
        .map(|theme| theme.updated_at)
        .unwrap_or(0);

    account_max.max(tag_max).max(theme_updated_at)
}

fn load_local_file_content_unlocked(app: &tauri::AppHandle) -> Result<String, String> {
    let data_path = get_storage_path(app)?;
    let temporary_path = data_path.with_extension("json.tmp");

    if !data_path.exists() && temporary_path.exists() {
        fs::rename(&temporary_path, &data_path).map_err(|e| e.to_string())?;
    }

    if data_path.exists() {
        let content = fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
        return normalize_payload_content(content);
    }

    #[cfg(desktop)]
    {
        if let Some(content) = migrate_legacy_app_data(app, &data_path)? {
            return normalize_payload_content(content);
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let old_data_path = exe_dir.join("AccountInfo.json");
                let legacy_data_path = exe_dir.join("data.json");

                let source_path = if old_data_path.exists() {
                    Some(old_data_path)
                } else if legacy_data_path.exists() {
                    Some(legacy_data_path)
                } else {
                    None
                };

                if let Some(path) = source_path {
                    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                    let normalized = normalize_payload_content(content)?;
                    if let Some(parent) = data_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(&data_path, &normalized).map_err(|e| e.to_string())?;
                    return Ok(normalized);
                }
            }
        }
    }

    Ok(default_sync_payload_json())
}

fn load_local_file_content(app: &tauri::AppHandle) -> Result<String, String> {
    let _guard = DATA_FILE_LOCK.lock().map_err(|e| e.to_string())?;
    load_local_file_content_unlocked(app)
}

fn local_file_metadata(app: &tauri::AppHandle) -> Result<FileSyncMetadata, String> {
    let content = load_local_file_content(app)?;
    let payload = parse_sync_payload(&content)?;

    Ok(FileSyncMetadata {
        updated_at: file_updated_at(&payload),
        sha256: file_sha256(&content),
        size: content.len() as u64,
    })
}

fn local_file_envelope(app: &tauri::AppHandle) -> Result<FileSyncEnvelope, String> {
    let content = load_local_file_content(app)?;
    let payload = parse_sync_payload(&content)?;

    Ok(FileSyncEnvelope {
        metadata: FileSyncMetadata {
            updated_at: file_updated_at(&payload),
            sha256: file_sha256(&content),
            size: content.len() as u64,
        },
        data: content,
    })
}

fn ensure_device_id(app: &tauri::AppHandle) -> Result<String, String> {
    let path = get_device_id_path(app)?;

    #[cfg(desktop)]
    let _ = migrate_small_app_file(&path, "device_id.txt")?;

    if path.exists() {
        return fs::read_to_string(&path)
            .map(|value| value.trim().to_string())
            .map_err(|e| e.to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let device_id = Uuid::new_v4().to_string();
    fs::write(&path, &device_id).map_err(|e| e.to_string())?;
    Ok(device_id)
}

// 读写数据文件的命令
#[tauri::command]
fn read_data_file(app: tauri::AppHandle) -> Result<String, String> {
    load_local_file_content(&app)
}

#[tauri::command]
fn write_data_file(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let _guard = DATA_FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let incoming_payload = parse_sync_payload(&data)?;
    let current_content = load_local_file_content_unlocked(&app)?;
    let current_payload = parse_sync_payload(&current_content)?;
    let merged_payload = merge_sync_payloads(current_payload, incoming_payload);
    write_sync_payload_unlocked(&app, &merged_payload)
}

fn write_sync_payload_unlocked(
    app: &tauri::AppHandle,
    payload: &SyncPayload,
) -> Result<(), String> {
    let data_path = get_storage_path(&app)?;
    let normalized = serde_json::to_string(payload).map_err(|e| e.to_string())?;

    if let Some(parent) = data_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let temporary_path = data_path.with_extension("json.tmp");
    fs::write(&temporary_path, normalized).map_err(|e| e.to_string())?;

    if data_path.exists() {
        fs::remove_file(&data_path).map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary_path, &data_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_data_file_path(app: tauri::AppHandle) -> Result<String, String> {
    let data_path = get_storage_path(&app)?;
    Ok(data_path.to_string_lossy().to_string())
}

fn start_sync_http_server(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Runtime::new() {
            Ok(runtime) => runtime,
            Err(_) => return,
        };

        runtime.block_on(async move {
            let router = Router::new()
                .route("/device", get(handle_device_info_request))
                .route("/sync", post(handle_sync_request))
                .route("/sync/metadata", post(handle_sync_metadata_request))
                .route("/sync/file", get(handle_sync_file_request))
                .route("/sync/push", post(handle_sync_push_request))
                .with_state(app.clone());

            let listener = match tokio::net::TcpListener::bind(("0.0.0.0", SYNC_PORT)).await {
                Ok(listener) => {
                    if let Ok(mut state) = app.state::<Mutex<SyncState>>().lock() {
                        state.server_ready = true;
                        state.server_error = None;
                    }
                    listener
                }
                Err(error) => {
                    let message = format!("同步服务端口 {} 启动失败：{}", SYNC_PORT, error);
                    if let Ok(mut state) = app.state::<Mutex<SyncState>>().lock() {
                        state.server_ready = false;
                        state.server_error = Some(message.clone());
                    }
                    let _ = app.emit("sync-server-error", message.clone());
                    eprintln!("{}", message);
                    return;
                }
            };

            let _ = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await;
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(SyncState::default()));

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            });
        }));
    }

    builder = builder.setup(|app| {
        let handle = app.handle().clone();
        start_sync_http_server(handle.clone());
        let _ = start_sync_discovery(handle, app.state::<Mutex<SyncState>>());

        #[cfg(desktop)]
        {
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>).unwrap();
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>).unwrap();
            let menu = Menu::with_items(app, &[&show_i, &quit_i]).unwrap();

            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap();

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("VaultLink - 密码管理")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            let is_minimized = window.is_minimized().unwrap_or(false);

                            if is_visible && !is_minimized {
                                let _ = window.hide();
                            } else {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)
                .unwrap();

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let _ = window_clone.hide();
                        api.prevent_close();
                    }
                    _ => {}
                });
            }
        }

        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![
            greet,
            read_data_file,
            write_data_file,
            get_data_file_path,
            get_device_info,
            set_device_name,
            start_sync_discovery,
            stop_sync_discovery,
            get_discovered_devices,
            get_sync_server_status,
            probe_known_devices,
            request_sync_from_device,
            request_file_sync_from_device
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AccountRecord {
    id: String,
    platform: String,
    tab_name: Option<String>,
    username: String,
    nickname: Option<String>,
    password: String,
    email: Option<String>,
    phone: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
    tags: Option<Vec<String>>,
    is_deleted: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct TagRecord {
    id: String,
    name: String,
    color: String,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
    order: Option<i64>,
    is_deleted: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ThemeRecord {
    preset_id: String,
    primary_color: String,
    #[serde(default)]
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SyncPayload {
    #[serde(default)]
    accounts: Vec<AccountRecord>,
    #[serde(default)]
    tags: Vec<TagRecord>,
    #[serde(default)]
    theme: Option<ThemeRecord>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SyncChangeSummary {
    added_accounts: u32,
    updated_accounts: u32,
    deleted_accounts: u32,
    added_tags: u32,
    updated_tags: u32,
    deleted_tags: u32,
    updated_theme: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncOperationResult {
    message: String,
    summary: SyncChangeSummary,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileSyncMetadata {
    updated_at: i64,
    sha256: String,
    size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileSyncEnvelope {
    metadata: FileSyncMetadata,
    data: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncDecisionRequest {
    local_metadata: FileSyncMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncDecisionResponse {
    action: String,
    message: String,
    local_metadata: FileSyncMetadata,
    remote_metadata: FileSyncMetadata,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncNoticePayload {
    source_ip: String,
    source_device_name: String,
    message: String,
    summary: SyncChangeSummary,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DeviceInfo {
    id: String,
    name: String,
    device_type: String, // "Windows" or "Android"
    ip: String,
    port: u16,
    last_seen_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiscoveryAnnouncement {
    app: String,
    version: String,
    id: String,
    name: String,
    device_type: String,
    port: u16,
    #[serde(default = "default_announce")]
    announce: bool,
}

fn default_announce() -> bool {
    true
}

struct SyncState {
    device_id: String,
    discovered_devices: Vec<DeviceInfo>,
    mdns: Option<ServiceDaemon>,
    discovery_running: bool,
    discovery_stop: Option<Arc<AtomicBool>>,
    server_ready: bool,
    server_error: Option<String>,
}

#[derive(Debug, Clone)]
struct LanInterface {
    name: String,
    ip: Ipv4Addr,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            device_id: String::new(),
            discovered_devices: Vec::new(),
            mdns: None,
            discovery_running: false,
            discovery_stop: None,
            server_ready: false,
            server_error: None,
        }
    }
}

const SERVICE_TYPE: &str = "_vaultlink._tcp.local.";
const SYNC_PORT: u16 = 53318;
const MULTICAST_PORT: u16 = 53318;
const MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
const DISCOVERY_VERSION: &str = "1.0";

#[tauri::command]
fn get_device_info(app: tauri::AppHandle) -> Result<DeviceInfo, String> {
    let name = read_device_name(&app)?;
    let ip = primary_lan_ipv4_address().unwrap_or_else(|| "127.0.0.1".to_string());
    let device_id = ensure_device_id(&app)?;

    #[cfg(desktop)]
    let device_type = "Windows".to_string();
    #[cfg(mobile)]
    let device_type = "Android".to_string();

    Ok(DeviceInfo {
        id: device_id,
        name,
        device_type,
        ip,
        port: SYNC_PORT,
        last_seen_at: unix_time_millis(),
    })
}

fn fallible_hostname() -> String {
    whoami::fallible::hostname().unwrap_or_else(|_| "Unknown Device".to_string())
}

fn read_device_name(app: &tauri::AppHandle) -> Result<String, String> {
    let path = get_device_name_path(app)?;

    #[cfg(desktop)]
    let _ = migrate_small_app_file(&path, "device_name.txt")?;

    if path.exists() {
        let name = fs::read_to_string(&path)
            .map_err(|e| e.to_string())?
            .trim()
            .to_string();
        if !name.is_empty() {
            return Ok(name);
        }
    }

    Ok(fallible_hostname())
}

#[tauri::command]
fn set_device_name(app: tauri::AppHandle, name: String) -> Result<DeviceInfo, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("设备名称不能为空".to_string());
    }
    if trimmed.chars().count() > 32 {
        return Err("设备名称不能超过 32 个字符".to_string());
    }

    let path = get_device_name_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, trimmed).map_err(|e| e.to_string())?;

    if let Ok(mut state) = app.state::<Mutex<SyncState>>().lock() {
        if let Some(stop) = state.discovery_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(mdns) = state.mdns.take() {
            let _ = mdns.shutdown();
        }
        state.discovery_running = false;
    }

    let device = get_device_info(app.clone())?;
    std::thread::sleep(Duration::from_millis(120));
    let _ = start_sync_discovery(app.clone(), app.state::<Mutex<SyncState>>());
    Ok(device)
}

fn is_usable_lan_ipv4(ip: Ipv4Addr) -> bool {
    !ip.is_loopback() && !ip.is_link_local() && !ip.is_broadcast() && !ip.is_unspecified()
}

fn ip_range_score(ip: Ipv4Addr) -> u8 {
    let octets = ip.octets();
    if octets[0] == 192 && octets[1] == 168 {
        0
    } else if octets[0] == 10 {
        10
    } else if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        20
    } else if ip.is_private() {
        30
    } else {
        100
    }
}

fn interface_score(name: &str) -> u8 {
    let lower = name.to_ascii_lowercase();

    if lower.contains("wlan")
        || lower.contains("wifi")
        || lower.contains("wi-fi")
        || lower.contains("wireless")
    {
        return 0;
    }

    if lower.contains("ethernet") || lower == "eth0" || lower.starts_with("en") {
        return 5;
    }

    if lower.contains("rmnet")
        || lower.contains("ccmni")
        || lower.contains("pdp")
        || lower.contains("cell")
        || lower.contains("mobile")
        || lower.contains("wwan")
        || lower.contains("tun")
        || lower.contains("tap")
        || lower.contains("vpn")
        || lower.contains("docker")
        || lower.contains("veth")
        || lower.contains("virtual")
        || lower.contains("vmware")
        || lower.contains("vbox")
        || lower.contains("hyper-v")
        || lower == "lo"
        || lower.starts_with("br-")
    {
        return 200;
    }

    50
}

fn preferred_lan_interfaces() -> Vec<LanInterface> {
    let mut interfaces = local_ip_address::list_afinet_netifas()
        .map(|items| {
            items
                .into_iter()
                .filter_map(|(name, ip)| match ip {
                    IpAddr::V4(ipv4) if is_usable_lan_ipv4(ipv4) => {
                        Some(LanInterface { name, ip: ipv4 })
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    interfaces.sort_by_key(|iface| (interface_score(&iface.name), ip_range_score(iface.ip)));

    let mut seen = HashSet::new();
    interfaces.retain(|iface| seen.insert(iface.ip));

    let preferred = interfaces
        .iter()
        .filter(|iface| interface_score(&iface.name) < 200)
        .cloned()
        .collect::<Vec<_>>();

    if preferred.is_empty() {
        interfaces
    } else {
        preferred
    }
}

fn ip_from_string(value: &str) -> Option<IpAddr> {
    let without_scope = value.split('%').next().unwrap_or(value);
    without_scope.parse::<IpAddr>().ok()
}

fn choose_lan_ipv4<I>(values: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    values
        .into_iter()
        .filter_map(|value| match ip_from_string(&value) {
            Some(IpAddr::V4(ip)) if is_usable_lan_ipv4(ip) => Some(ip),
            _ => None,
        })
        .min_by_key(|ip| ip_range_score(*ip))
        .map(|ip| ip.to_string())
}

fn local_lan_ipv4_addresses() -> HashSet<String> {
    preferred_lan_interfaces()
        .into_iter()
        .map(|iface| iface.ip.to_string())
        .collect()
}

fn route_local_ipv4(target: Ipv4Addr, port: u16) -> Option<String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((target, port)).ok()?;

    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if is_usable_lan_ipv4(ip) => Some(ip.to_string()),
        _ => None,
    }
}

fn primary_lan_ipv4_address() -> Option<String> {
    let interfaces = preferred_lan_interfaces();
    if interfaces.is_empty() {
        return None;
    }

    if let Some(route_ip) = route_local_ipv4(MULTICAST_ADDR, MULTICAST_PORT) {
        if interfaces
            .iter()
            .any(|iface| iface.ip.to_string() == route_ip)
        {
            return Some(route_ip);
        }
    }

    interfaces
        .first()
        .map(|iface| iface.ip.to_string())
        .or_else(|| choose_lan_ipv4(local_lan_ipv4_addresses()))
}

fn prop_value(props: &TxtProperties, key: &str) -> Option<String> {
    props.get(key).map(|value| value.val_str().to_string())
}

fn sync_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn header_device_name(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-device-name")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(32).collect())
}

async fn probe_device_with_timeout(ip: &str, timeout: Duration) -> Option<DeviceInfo> {
    let url = format!("http://{}:{}/device", ip, SYNC_PORT);
    let response = reqwest::Client::new()
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    response.json::<DeviceInfo>().await.ok().map(|mut device| {
        device.ip = ip.to_string();
        device
    })
}

async fn probe_device(ip: &str) -> Option<DeviceInfo> {
    probe_device_with_timeout(ip, Duration::from_secs(2)).await
}

fn make_discovery_announcement(device: &DeviceInfo) -> DiscoveryAnnouncement {
    DiscoveryAnnouncement {
        app: "VaultLink".to_string(),
        version: DISCOVERY_VERSION.to_string(),
        id: device.id.clone(),
        name: device.name.clone(),
        device_type: device.device_type.clone(),
        port: SYNC_PORT,
        announce: true,
    }
}

fn is_vaultlink_announcement(packet: &DiscoveryAnnouncement) -> bool {
    packet.app == "VaultLink" && packet.port > 0 && !packet.id.is_empty()
}

fn subnet_scan_targets(local_interfaces: &[LanInterface]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut targets = Vec::new();

    for iface in local_interfaces {
        let octets = iface.ip.octets();
        for host in 1..=254 {
            if host == octets[3] {
                continue;
            }

            let target = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], host);
            if seen.insert(target.clone()) {
                targets.push(target);
            }
        }
    }

    targets
}

fn discovery_broadcast_targets(local_interfaces: &[LanInterface]) -> Vec<SocketAddrV4> {
    let mut seen = HashSet::new();
    let mut targets = Vec::new();

    for iface in local_interfaces {
        let [a, b, c, _] = iface.ip.octets();
        for addr in [
            SocketAddrV4::new(Ipv4Addr::new(255, 255, 255, 255), MULTICAST_PORT),
            SocketAddrV4::new(Ipv4Addr::new(a, b, c, 255), MULTICAST_PORT),
        ] {
            if seen.insert(addr) {
                targets.push(addr);
            }
        }
    }

    targets
}

fn discovery_send_sockets(local_interfaces: &[LanInterface]) -> Vec<UdpSocket> {
    local_interfaces
        .iter()
        .filter_map(|iface| {
            let socket = UdpSocket::bind((iface.ip, 0)).ok()?;
            let _ = socket.set_broadcast(true);
            Some(socket)
        })
        .collect()
}

fn send_discovery_packets(
    send_sockets: &[UdpSocket],
    announcement: &[u8],
    broadcast_targets: &[SocketAddrV4],
) {
    let multicast_target = SocketAddrV4::new(MULTICAST_ADDR, MULTICAST_PORT);

    for socket in send_sockets {
        let _ = socket.send_to(announcement, multicast_target);
        for target in broadcast_targets {
            let _ = socket.send_to(announcement, target);
        }
    }
}

fn remember_discovered_device(app: &tauri::AppHandle, device: DeviceInfo) {
    let Some(IpAddr::V4(ip)) = ip_from_string(&device.ip) else {
        return;
    };

    if device.id.is_empty() || !is_usable_lan_ipv4(ip) {
        return;
    }

    let mut emitted_device = None;
    if let Ok(mut state) = app.state::<Mutex<SyncState>>().lock() {
        let local_ips = local_lan_ipv4_addresses();
        if device.id == state.device_id {
            let current_id = state.device_id.clone();
            if let Some(current_device) = state
                .discovered_devices
                .iter_mut()
                .find(|existing| existing.id == current_id)
            {
                current_device.ip = device.ip;
            }
            return;
        }

        if local_ips.contains(&device.ip) {
            return;
        }

        if let Some(existing) = state
            .discovered_devices
            .iter_mut()
            .find(|d| d.id == device.id)
        {
            let should_emit = existing.ip != device.ip
                || existing.name != device.name
                || existing.device_type != device.device_type
                || existing.port != device.port
                || device.last_seen_at.saturating_sub(existing.last_seen_at) > 10_000;
            *existing = device.clone();
            if should_emit {
                emitted_device = Some(device);
            }
        } else {
            state.discovered_devices.push(device.clone());
            emitted_device = Some(device);
        }
    }

    if let Some(device) = emitted_device {
        let _ = app.emit("sync-device-seen", device);
    }
}

fn start_multicast_discovery(
    app: tauri::AppHandle,
    current_device: DeviceInfo,
    local_interfaces: Vec<LanInterface>,
    stop: Arc<AtomicBool>,
) {
    if local_interfaces.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        let socket = match UdpSocket::bind(("0.0.0.0", MULTICAST_PORT)) {
            Ok(socket) => socket,
            Err(error) => {
                if let Ok(mut state) = app.state::<Mutex<SyncState>>().lock() {
                    state.discovery_running = false;
                    state.discovery_stop = None;
                }
                let _ = app.emit(
                    "sync-discovery-error",
                    format!("设备发现端口 {} 启动失败：{}", MULTICAST_PORT, error),
                );
                return;
            }
        };

        let _ = socket.set_nonblocking(true);
        let _ = socket.set_multicast_loop_v4(false);
        let _ = socket.set_broadcast(true);

        for iface in &local_interfaces {
            let _ = socket.join_multicast_v4(&MULTICAST_ADDR, &iface.ip);
        }

        let announcement_packet = make_discovery_announcement(&current_device);
        let announcement = match serde_json::to_vec(&announcement_packet) {
            Ok(announcement) => announcement,
            Err(_) => return,
        };
        let response = serde_json::to_vec(&DiscoveryAnnouncement {
            announce: false,
            ..announcement_packet
        })
        .unwrap_or_else(|_| announcement.clone());
        let send_sockets = discovery_send_sockets(&local_interfaces);
        let broadcast_targets = discovery_broadcast_targets(&local_interfaces);

        let mut buffer = [0_u8; 2048];
        let mut last_announcement = UNIX_EPOCH;

        while !stop.load(Ordering::Relaxed) {
            if last_announcement
                .elapsed()
                .map_or(true, |elapsed| elapsed >= Duration::from_secs(2))
            {
                send_discovery_packets(&send_sockets, &announcement, &broadcast_targets);
                last_announcement = SystemTime::now();
            }

            match socket.recv_from(&mut buffer) {
                Ok((size, sender)) => {
                    let Ok(packet) =
                        serde_json::from_slice::<DiscoveryAnnouncement>(&buffer[..size])
                    else {
                        continue;
                    };

                    if !is_vaultlink_announcement(&packet) || packet.id == current_device.id {
                        continue;
                    }

                    let device = DeviceInfo {
                        id: packet.id,
                        name: packet.name,
                        device_type: packet.device_type,
                        ip: sender.ip().to_string(),
                        port: packet.port,
                        last_seen_at: unix_time_millis(),
                    };
                    remember_discovered_device(&app, device);

                    if packet.announce {
                        send_discovery_packets(&send_sockets, &response, &broadcast_targets);
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(80));
                }
                Err(_) => break,
            }
        }

        for iface in &local_interfaces {
            let _ = socket.leave_multicast_v4(&MULTICAST_ADDR, &iface.ip);
        }
    });
}

fn start_lan_probe_scan(app: tauri::AppHandle, local_interfaces: Vec<LanInterface>) {
    let targets = subnet_scan_targets(&local_interfaces);
    if targets.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        let already_found = app
            .state::<Mutex<SyncState>>()
            .lock()
            .map(|state| {
                let now = unix_time_millis();
                state.discovered_devices.iter().any(|device| {
                    device.id != state.device_id
                        && now.saturating_sub(device.last_seen_at) <= 10_000
                })
            })
            .unwrap_or(false);
        if already_found {
            return;
        }

        let runtime = match tokio::runtime::Runtime::new() {
            Ok(runtime) => runtime,
            Err(_) => return,
        };

        runtime.block_on(async move {
            let semaphore = Arc::new(tokio::sync::Semaphore::new(32));
            let mut tasks = tokio::task::JoinSet::new();

            for target in targets {
                let semaphore = Arc::clone(&semaphore);
                tasks.spawn(async move {
                    let _permit = semaphore.acquire_owned().await.ok()?;
                    probe_device_with_timeout(&target, Duration::from_millis(900)).await
                });
            }

            while let Some(result) = tasks.join_next().await {
                if let Ok(Some(device)) = result {
                    remember_discovered_device(&app, device);
                }
            }
        });
    });
}

#[tauri::command]
fn start_sync_discovery(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<SyncState>>,
) -> Result<Vec<DeviceInfo>, String> {
    let current_device = get_device_info(app.clone())?;
    let local_interfaces = preferred_lan_interfaces();
    if local_interfaces.is_empty() {
        return Err("未检测到可用的局域网连接，请先连接 WiFi".to_string());
    }
    {
        let mut sync_state = state.lock().map_err(|e| e.to_string())?;
        sync_state.device_id = current_device.id.clone();
        let network_changed = sync_state
            .discovered_devices
            .iter()
            .find(|device| device.id == current_device.id)
            .map(|device| device.ip != current_device.ip)
            .unwrap_or(false);

        if let Some(existing) = sync_state
            .discovered_devices
            .iter_mut()
            .find(|device| device.id == current_device.id)
        {
            *existing = current_device.clone();
        } else {
            sync_state.discovered_devices.push(current_device.clone());
        }

        if sync_state.discovery_running && !network_changed {
            let now = unix_time_millis();
            let current_id = sync_state.device_id.clone();
            sync_state.discovered_devices.retain(|device| {
                device.id == current_id || now.saturating_sub(device.last_seen_at) <= 10_000
            });
            let devices = sync_state.discovered_devices.clone();
            drop(sync_state);
            start_lan_probe_scan(app, local_interfaces);
            return Ok(devices);
        }

        if sync_state.discovery_running {
            if let Some(stop) = sync_state.discovery_stop.take() {
                stop.store(true, Ordering::Relaxed);
            }
            if let Some(mdns) = sync_state.mdns.take() {
                let _ = mdns.shutdown();
            }
            sync_state.discovery_running = false;
            std::thread::sleep(Duration::from_millis(120));
        }

        sync_state.discovery_running = true;
        let stop = Arc::new(AtomicBool::new(false));
        sync_state.discovery_stop = Some(stop.clone());
        drop(sync_state);

        start_multicast_discovery(
            app.clone(),
            current_device.clone(),
            local_interfaces.clone(),
            stop,
        );
    }

    // mDNS 是辅助发现路径；初始化失败时不能阻断 UDP 和网段探测。
    if let Ok(mdns) = ServiceDaemon::new() {
        let mut properties = std::collections::HashMap::new();
        properties.insert("id".to_string(), current_device.id.clone());
        properties.insert("name".to_string(), current_device.name.clone());
        properties.insert("type".to_string(), current_device.device_type.clone());

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &current_device.id,
            &format!("{}.local.", current_device.id),
            &current_device.ip,
            SYNC_PORT,
            Some(properties),
        )
        .map(|service| service.enable_addr_auto());

        if let Ok(service) = service {
            if mdns.register(service).is_ok() {
                if let Ok(receiver) = mdns.browse(SERVICE_TYPE) {
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        let runtime = tokio::runtime::Runtime::new().ok();

                        while let Ok(event) = receiver.recv() {
                            if let ServiceEvent::ServiceResolved(info) = event {
                                let props = info.get_properties();
                                let id = prop_value(props, "id").unwrap_or_default();
                                let ip = choose_lan_ipv4(
                                    info.get_addresses()
                                        .iter()
                                        .map(|address| address.to_string()),
                                );
                                let Some(ip) = ip else {
                                    continue;
                                };
                                let Some(runtime) = runtime.as_ref() else {
                                    continue;
                                };
                                let Some(mut device) = runtime.block_on(probe_device(&ip)) else {
                                    continue;
                                };
                                if !id.is_empty() && id != device.id {
                                    continue;
                                }
                                device.last_seen_at = unix_time_millis();
                                remember_discovered_device(&handle, device);
                            }
                        }
                    });

                    if let Ok(mut sync_state) = state.lock() {
                        sync_state.mdns = Some(mdns);
                    }
                }
            }
        }
    }

    start_lan_probe_scan(app.clone(), local_interfaces);
    let sync_state = state.lock().map_err(|e| e.to_string())?;
    Ok(sync_state.discovered_devices.clone())
}

#[tauri::command]
fn stop_sync_discovery(state: tauri::State<'_, Mutex<SyncState>>) -> Result<(), String> {
    let mut sync_state = state.lock().map_err(|e| e.to_string())?;
    if let Some(mdns) = sync_state.mdns.take() {
        let _ = mdns.shutdown();
    }
    if let Some(stop) = sync_state.discovery_stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    sync_state.discovery_running = false;
    sync_state.discovered_devices.clear();
    Ok(())
}

#[tauri::command]
fn get_discovered_devices(
    state: tauri::State<'_, Mutex<SyncState>>,
) -> Result<Vec<DeviceInfo>, String> {
    let sync_state = state.lock().map_err(|e| e.to_string())?;
    let local_ips = local_lan_ipv4_addresses();
    let mut seen = HashSet::new();
    let now = unix_time_millis();
    let devices = sync_state
        .discovered_devices
        .iter()
        .filter(|device| seen.insert(device.id.clone()))
        .filter(|device| {
            if device.id == sync_state.device_id {
                return true;
            }

            if now.saturating_sub(device.last_seen_at) > 10_000 {
                return false;
            }

            matches!(
                ip_from_string(&device.ip),
                Some(IpAddr::V4(ip)) if is_usable_lan_ipv4(ip) && !local_ips.contains(&device.ip)
            )
        })
        .cloned()
        .collect();

    Ok(devices)
}

#[tauri::command]
fn get_sync_server_status(state: tauri::State<'_, Mutex<SyncState>>) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    if state.server_ready {
        Ok(())
    } else {
        Err(state
            .server_error
            .clone()
            .unwrap_or_else(|| "同步服务正在启动，请稍后重试".to_string()))
    }
}

#[tauri::command]
async fn probe_known_devices(
    app: tauri::AppHandle,
    target_ips: Vec<String>,
) -> Result<Vec<DeviceInfo>, String> {
    let local_ips = local_lan_ipv4_addresses();
    let mut seen = HashSet::new();
    let targets = target_ips
        .into_iter()
        .filter(|ip| seen.insert(ip.clone()))
        .filter(|ip| !local_ips.contains(ip))
        .filter(|ip| {
            matches!(
                ip_from_string(ip),
                Some(IpAddr::V4(value)) if is_usable_lan_ipv4(value)
            )
        })
        .take(16)
        .collect::<Vec<_>>();

    let mut tasks = tokio::task::JoinSet::new();
    for target in targets {
        tasks.spawn(
            async move { probe_device_with_timeout(&target, Duration::from_millis(550)).await },
        );
    }

    let mut devices = Vec::new();
    while let Some(result) = tasks.join_next().await {
        if let Ok(Some(mut device)) = result {
            device.last_seen_at = unix_time_millis();
            remember_discovered_device(&app, device.clone());
            devices.push(device);
        }
    }

    Ok(devices)
}

async fn handle_device_info_request(
    AxumState(app): AxumState<tauri::AppHandle>,
) -> Result<Json<DeviceInfo>, (StatusCode, String)> {
    get_device_info(app)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_sync_request(
    AxumState(app): AxumState<tauri::AppHandle>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(remote_payload): Json<SyncPayload>,
) -> Result<Json<SyncPayload>, (StatusCode, String)> {
    let _guard = DATA_FILE_LOCK
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let local_payload =
        read_sync_payload_unlocked(&app).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let merged_payload = merge_sync_payloads(local_payload.clone(), remote_payload);
    let summary = summarize_sync_changes(&local_payload, &merged_payload);

    if total_sync_changes(&summary) > 0 {
        backup_data_file_unlocked(&app, "before-sync")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        write_sync_payload_unlocked(&app, &merged_payload)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }

    println!("Accepted legacy LAN sync request from {}", addr.ip());
    let source_device_name = header_device_name(&headers).unwrap_or_else(|| addr.ip().to_string());
    emit_sync_notice(
        &app,
        addr.ip().to_string(),
        source_device_name,
        describe_sync_summary(&summary),
        summary,
    );
    Ok(Json(merged_payload))
}

fn sync_decision(
    local_metadata: &FileSyncMetadata,
    remote_metadata: &FileSyncMetadata,
) -> SyncDecisionResponse {
    if local_metadata.sha256 == remote_metadata.sha256 {
        return SyncDecisionResponse {
            action: "noop".to_string(),
            message: "两端数据已经一致，无需同步".to_string(),
            local_metadata: local_metadata.clone(),
            remote_metadata: remote_metadata.clone(),
        };
    }

    if remote_metadata.updated_at > local_metadata.updated_at {
        return SyncDecisionResponse {
            action: "pull".to_string(),
            message: "对方数据更新，建议拉取覆盖本地".to_string(),
            local_metadata: local_metadata.clone(),
            remote_metadata: remote_metadata.clone(),
        };
    }

    if remote_metadata.updated_at < local_metadata.updated_at {
        return SyncDecisionResponse {
            action: "push".to_string(),
            message: "本地数据更新，建议推送覆盖对方".to_string(),
            local_metadata: local_metadata.clone(),
            remote_metadata: remote_metadata.clone(),
        };
    }

    SyncDecisionResponse {
        action: "conflict".to_string(),
        message: "两端修改时间相同但内容不同，请确认后再覆盖同步".to_string(),
        local_metadata: local_metadata.clone(),
        remote_metadata: remote_metadata.clone(),
    }
}

async fn handle_sync_metadata_request(
    AxumState(app): AxumState<tauri::AppHandle>,
    Json(request): Json<SyncDecisionRequest>,
) -> Result<Json<SyncDecisionResponse>, (StatusCode, String)> {
    let local_metadata =
        local_file_metadata(&app).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(sync_decision(
        &local_metadata,
        &request.local_metadata,
    )))
}

async fn handle_sync_file_request(
    AxumState(app): AxumState<tauri::AppHandle>,
) -> Result<Json<FileSyncEnvelope>, (StatusCode, String)> {
    local_file_envelope(&app)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_sync_push_request(
    AxumState(app): AxumState<tauri::AppHandle>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(remote_file): Json<FileSyncEnvelope>,
) -> Result<Json<SyncDecisionResponse>, (StatusCode, String)> {
    let normalized =
        normalize_payload_content(remote_file.data).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let payload = parse_sync_payload(&normalized).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let recalculated = FileSyncMetadata {
        updated_at: file_updated_at(&payload),
        sha256: file_sha256(&normalized),
        size: normalized.len() as u64,
    };

    if remote_file.metadata.sha256 != recalculated.sha256
        || remote_file.metadata.updated_at != recalculated.updated_at
    {
        return Err((StatusCode::BAD_REQUEST, "同步文件校验失败".to_string()));
    }

    let before_payload =
        read_sync_payload(app.clone()).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let summary = summarize_sync_changes(&before_payload, &payload);

    if total_sync_changes(&summary) > 0 {
        backup_data_file(&app, "before-sync")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        write_data_file(app.clone(), normalized)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }

    println!("Accepted LAN file sync from {}", addr.ip());
    let source_device_name = header_device_name(&headers).unwrap_or_else(|| addr.ip().to_string());
    emit_sync_notice(
        &app,
        addr.ip().to_string(),
        source_device_name,
        describe_sync_summary(&summary),
        summary,
    );

    let local_metadata =
        local_file_metadata(&app).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(SyncDecisionResponse {
        action: "applied".to_string(),
        message: "已接收并覆盖本地数据文件".to_string(),
        local_metadata,
        remote_metadata: remote_file.metadata,
    }))
}

#[tauri::command]
async fn request_sync_from_device(
    app: tauri::AppHandle,
    target_ip: String,
) -> Result<SyncOperationResult, String> {
    let current_device = get_device_info(app.clone())?;
    let target_ipv4 = match ip_from_string(&target_ip) {
        Some(IpAddr::V4(ip)) if is_usable_lan_ipv4(ip) => ip,
        _ => {
            return Err("只支持同一局域网 IPv4 地址同步，请重新搜索设备".to_string());
        }
    };

    if local_lan_ipv4_addresses().contains(&target_ipv4.to_string()) {
        return Err("不能同步当前设备，请选择另一台设备".to_string());
    }

    let url = format!("http://{}:{}/sync", target_ipv4, SYNC_PORT);
    let local_data = read_sync_payload(app.clone())?;

    let client = sync_http_client()?;
    let response = client
        .post(url)
        .header("X-Device-Name", current_device.name.clone())
        .header("X-Device-Id", current_device.id.clone())
        .json(&local_data)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status() == StatusCode::NOT_FOUND {
        return request_legacy_sync_from_device(app, &target_ip).await;
    }

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("对方返回错误：{}", err_text));
    }

    let remote_merged_payload: SyncPayload = response.json().await.map_err(|e| e.to_string())?;
    let _guard = DATA_FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let latest_local_payload = read_sync_payload_unlocked(&app)?;
    let merged_payload = merge_sync_payloads(latest_local_payload.clone(), remote_merged_payload);
    let summary = summarize_sync_changes(&latest_local_payload, &merged_payload);

    if total_sync_changes(&summary) > 0 {
        backup_data_file_unlocked(&app, "before-sync")?;
        write_sync_payload_unlocked(&app, &merged_payload)?;
    }

    Ok(build_sync_result("同步完成，已与对方完成双向合并", summary))
}

fn read_sync_payload(app: tauri::AppHandle) -> Result<SyncPayload, String> {
    let content = read_data_file(app)?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn read_sync_payload_unlocked(app: &tauri::AppHandle) -> Result<SyncPayload, String> {
    let content = load_local_file_content_unlocked(app)?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

async fn request_legacy_sync_from_device(
    app: tauri::AppHandle,
    target_ip: &str,
) -> Result<SyncOperationResult, String> {
    let current_device = get_device_info(app.clone())?;
    let target_ipv4 = match ip_from_string(target_ip) {
        Some(IpAddr::V4(ip)) if is_usable_lan_ipv4(ip) => ip,
        _ => {
            return Err("只支持同一局域网 IPv4 地址同步，请重新搜索设备".to_string());
        }
    };
    let url = format!("http://{}:{}/sync", target_ipv4, SYNC_PORT);
    let local_data = read_sync_payload(app.clone())?;

    let client = sync_http_client()?;
    let response = client
        .post(url)
        .header("X-Device-Name", current_device.name.clone())
        .header("X-Device-Id", current_device.id.clone())
        .json(&local_data)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("对方返回错误：{}", err_text));
    }

    let merged_payload: SyncPayload = response.json().await.map_err(|e| e.to_string())?;
    let summary = summarize_sync_changes(&local_data, &merged_payload);

    if total_sync_changes(&summary) > 0 {
        backup_data_file(&app, "before-sync")?;
        write_sync_payload(app, &merged_payload)?;
    }

    Ok(build_sync_result("同步完成，已与对方完成双向合并", summary))
}

#[tauri::command]
async fn request_file_sync_from_device(
    app: tauri::AppHandle,
    target_ip: String,
) -> Result<SyncOperationResult, String> {
    let current_device = get_device_info(app.clone())?;
    let target_ipv4 = match ip_from_string(&target_ip) {
        Some(IpAddr::V4(ip)) if is_usable_lan_ipv4(ip) => ip,
        _ => {
            return Err("只支持同一局域网 IPv4 地址同步，请重新搜索设备".to_string());
        }
    };

    if local_lan_ipv4_addresses().contains(&target_ipv4.to_string()) {
        return Err("不能同步当前设备，请选择另一台设备".to_string());
    }

    let base_url = format!("http://{}:{}", target_ipv4, SYNC_PORT);
    let local_file = local_file_envelope(&app)?;
    let local_metadata = local_file.metadata.clone();
    let before_payload = read_sync_payload(app.clone())?;

    let client = sync_http_client()?;
    let response = client
        .post(format!("{}/sync/metadata", base_url))
        .header("X-Device-Name", current_device.name.clone())
        .header("X-Device-Id", current_device.id.clone())
        .json(&SyncDecisionRequest {
            local_metadata: local_metadata.clone(),
        })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("对方返回错误：{}", err_text));
    }

    let decision: SyncDecisionResponse = response.json().await.map_err(|e| e.to_string())?;

    match decision.action.as_str() {
        "noop" => Ok(build_sync_result(
            decision.message,
            SyncChangeSummary::default(),
        )),
        "pull" => {
            let pull_response = client
                .get(format!("{}/sync/file", base_url))
                .header("X-Device-Name", current_device.name.clone())
                .header("X-Device-Id", current_device.id.clone())
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !pull_response.status().is_success() {
                let err_text = pull_response.text().await.unwrap_or_default();
                return Err(format!("拉取对方数据失败：{}", err_text));
            }

            let remote_file: FileSyncEnvelope =
                pull_response.json().await.map_err(|e| e.to_string())?;
            let normalized = normalize_payload_content(remote_file.data)?;
            let remote_payload = parse_sync_payload(&normalized)?;
            let summary = summarize_sync_changes(&before_payload, &remote_payload);
            backup_data_file(&app, "before-sync")?;
            write_data_file(app, normalized)?;
            Ok(build_sync_result("已拉取对方最新数据", summary))
        }
        "push" => {
            let push_response = client
                .post(format!("{}/sync/push", base_url))
                .header("X-Device-Name", current_device.name.clone())
                .header("X-Device-Id", current_device.id.clone())
                .json(&local_file)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !push_response.status().is_success() {
                let err_text = push_response.text().await.unwrap_or_default();
                return Err(format!("推送本地数据失败：{}", err_text));
            }

            let push_result: SyncDecisionResponse =
                push_response.json().await.map_err(|e| e.to_string())?;
            Ok(build_sync_result(
                push_result.message,
                SyncChangeSummary::default(),
            ))
        }
        "conflict" => Err(decision.message),
        _ => Err(format!("未知同步状态：{}", decision.action)),
    }
}

fn write_sync_payload(app: tauri::AppHandle, payload: &SyncPayload) -> Result<(), String> {
    let content = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    write_data_file(app, content)
}

fn remote_wins_tie<T: Serialize>(local: &T, remote: &T) -> bool {
    let local_value = serde_json::to_string(local).unwrap_or_default();
    let remote_value = serde_json::to_string(remote).unwrap_or_default();
    remote_value > local_value
}

fn merge_sync_payloads(mut local_data: SyncPayload, remote_payload: SyncPayload) -> SyncPayload {
    for remote_acc in remote_payload.accounts {
        if let Some(local_acc) = local_data
            .accounts
            .iter_mut()
            .find(|a| a.id == remote_acc.id)
        {
            if remote_acc.updated_at > local_acc.updated_at
                || (remote_acc.updated_at == local_acc.updated_at
                    && remote_wins_tie(local_acc, &remote_acc))
            {
                *local_acc = remote_acc;
            }
        } else {
            local_data.accounts.push(remote_acc);
        }
    }

    for remote_tag in remote_payload.tags {
        if let Some(local_tag) = local_data.tags.iter_mut().find(|t| t.id == remote_tag.id) {
            if remote_tag.updated_at > local_tag.updated_at
                || (remote_tag.updated_at == local_tag.updated_at
                    && remote_wins_tie(local_tag, &remote_tag))
            {
                *local_tag = remote_tag;
            }
        } else {
            local_data.tags.push(remote_tag);
        }
    }

    if let Some(remote_theme) = remote_payload.theme {
        match &local_data.theme {
            Some(local_theme)
                if local_theme.updated_at > remote_theme.updated_at
                    || (local_theme.updated_at == remote_theme.updated_at
                        && !remote_wins_tie(local_theme, &remote_theme)) => {}
            _ => local_data.theme = Some(remote_theme),
        }
    }

    local_data
}

fn summarize_sync_changes(before: &SyncPayload, after: &SyncPayload) -> SyncChangeSummary {
    let mut summary = SyncChangeSummary::default();

    for account in &after.accounts {
        match before.accounts.iter().find(|item| item.id == account.id) {
            None => {
                summary.added_accounts += 1;
                if account.is_deleted.unwrap_or(false) {
                    summary.deleted_accounts += 1;
                }
            }
            Some(previous) if previous != account => {
                summary.updated_accounts += 1;
                if !previous.is_deleted.unwrap_or(false) && account.is_deleted.unwrap_or(false) {
                    summary.deleted_accounts += 1;
                }
            }
            _ => {}
        }
    }

    for tag in &after.tags {
        match before.tags.iter().find(|item| item.id == tag.id) {
            None => {
                summary.added_tags += 1;
                if tag.is_deleted.unwrap_or(false) {
                    summary.deleted_tags += 1;
                }
            }
            Some(previous) if previous != tag => {
                summary.updated_tags += 1;
                if !previous.is_deleted.unwrap_or(false) && tag.is_deleted.unwrap_or(false) {
                    summary.deleted_tags += 1;
                }
            }
            _ => {}
        }
    }

    if before.theme != after.theme {
        summary.updated_theme = 1;
    }

    summary
}

fn total_sync_changes(summary: &SyncChangeSummary) -> u32 {
    summary.added_accounts
        + summary.updated_accounts
        + summary.deleted_accounts
        + summary.added_tags
        + summary.updated_tags
        + summary.deleted_tags
        + summary.updated_theme
}

fn describe_sync_summary(summary: &SyncChangeSummary) -> String {
    let mut lines = Vec::new();
    let account_touched = summary.added_accounts + summary.updated_accounts;
    let tag_touched = summary.added_tags + summary.updated_tags;

    if account_touched > 0 {
        lines.push(format!(
            "账号 {} 条：新增 {}，更新 {}，删除 {}",
            account_touched,
            summary.added_accounts,
            summary.updated_accounts,
            summary.deleted_accounts
        ));
    }

    if tag_touched > 0 {
        lines.push(format!(
            "标签 {} 条：新增 {}，更新 {}，删除 {}",
            tag_touched, summary.added_tags, summary.updated_tags, summary.deleted_tags
        ));
    }

    if summary.updated_theme > 0 {
        lines.push("主题设置已更新".to_string());
    }

    if lines.is_empty() {
        "同步完成，两端数据已经一致。".to_string()
    } else {
        format!("同步完成，{}", lines.join("；"))
    }
}

fn build_sync_result(
    message: impl Into<String>,
    summary: SyncChangeSummary,
) -> SyncOperationResult {
    SyncOperationResult {
        message: message.into(),
        summary,
    }
}

fn emit_sync_notice(
    app: &tauri::AppHandle,
    source_ip: String,
    source_device_name: String,
    message: String,
    summary: SyncChangeSummary,
) {
    let payload = SyncNoticePayload {
        source_ip,
        source_device_name,
        message,
        summary,
    };
    let _ = app.emit("sync-notice", payload);
}

// 保留 greet 命令以避免编译错误
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
