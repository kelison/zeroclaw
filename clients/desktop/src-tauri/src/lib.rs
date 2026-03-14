use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

const SOCKET_URL: &str = "ws://127.0.0.1:7703";
const MAX_WORKSPACE_DEPTH: usize = 5;
const MAX_FILE_BYTES: usize = 200_000;
const SETTINGS_FILE: &str = "desktop-settings.json";
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_HIDE_ID: &str = "tray-hide";
const TRAY_NEW_SESSION_ID: &str = "tray-new-session";
const TRAY_QUIT_ID: &str = "tray-quit";
const DEFAULT_SESSION_PREFIX: &str = "Session ";

#[derive(Clone)]
struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    socket_tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    app_data_dir: PathBuf,
    database_path: PathBuf,
    active_session_id: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SocketEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    blocks: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectionPayload {
    status: String,
    detail: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SocketOutbound {
    text: String,
    files: Vec<String>,
    user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<FileNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryMessage {
    id: String,
    role: String,
    text: Option<String>,
    files: Option<Vec<String>>,
    blocks: Option<Value>,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionSummary {
    id: String,
    title: String,
    preview: Option<String>,
    #[serde(rename = "messageCount")]
    message_count: usize,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionBootstrap {
    sessions: Vec<SessionSummary>,
    #[serde(rename = "activeSessionId")]
    active_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct DesktopSettings {
    workspace: Option<String>,
    active_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkspaceState {
    workspace: Option<String>,
    tree: Vec<FileNode>,
}

fn create_app_state(app: &AppHandle) -> Result<AppState> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?;
    fs::create_dir_all(&app_data_dir)
        .with_context(|| format!("failed to create app data dir {}", app_data_dir.display()))?;
    let database_path = app_data_dir.join("history.sqlite3");
    init_database(&database_path)?;
    Ok(AppState {
        inner: Arc::new(AppStateInner {
            socket_tx: Mutex::new(None),
            app_data_dir,
            database_path,
            active_session_id: Mutex::new(None),
        }),
    })
}

fn init_database(database_path: &Path) -> Result<()> {
    let connection = Connection::open(database_path)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            files TEXT,
            blocks TEXT,
            created_at TEXT NOT NULL
        );",
    )?;
    let mut statement = connection.prepare("PRAGMA table_info(messages)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if !columns.iter().any(|column| column == "files") {
        connection.execute("ALTER TABLE messages ADD COLUMN files TEXT", [])?;
    }
    if !columns.iter().any(|column| column == "session_id") {
        connection.execute("ALTER TABLE messages ADD COLUMN session_id TEXT", [])?;
    }
    migrate_existing_history(&connection)?;
    Ok(())
}

fn create_session_row(connection: &Connection, title: &str) -> Result<SessionSummary> {
    let session = SessionSummary {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        preview: None,
        message_count: 0,
        created_at: current_timestamp_string(connection)?,
        updated_at: current_timestamp_string(connection)?,
    };
    connection.execute(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            session.id,
            session.title,
            session.created_at,
            session.updated_at
        ],
    )?;
    Ok(session)
}

fn derive_session_title(text: &str, fallback: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }

    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title = collapsed.chars().take(40).collect::<String>();
    if collapsed.chars().count() > 40 {
        title.push_str("...");
    }
    if title.is_empty() {
        fallback.to_string()
    } else {
        title
    }
}

fn current_timestamp_string(connection: &Connection) -> Result<String> {
    let value = connection.query_row("SELECT datetime('now')", [], |row| row.get(0))?;
    Ok(value)
}

fn migrate_existing_history(connection: &Connection) -> Result<()> {
    let session_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;
    let orphan_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM messages WHERE session_id IS NULL OR session_id = ''",
        [],
        |row| row.get(0),
    )?;

    if orphan_count == 0 && session_count > 0 {
        return Ok(());
    }

    let fallback_session = if session_count == 0 {
        create_session_row(connection, "Imported Session")?
    } else {
        connection.query_row(
            "SELECT id, title, created_at, updated_at
             FROM sessions
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1",
            [],
            |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    preview: None,
                    message_count: 0,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )?
    };

    if orphan_count > 0 {
        connection.execute(
            "UPDATE messages
             SET session_id = ?1
             WHERE session_id IS NULL OR session_id = ''",
            params![fallback_session.id],
        )?;
        connection.execute(
            "UPDATE sessions
             SET updated_at = COALESCE(
                (SELECT MAX(created_at) FROM messages WHERE session_id = ?1),
                updated_at
             )
             WHERE id = ?1",
            params![fallback_session.id],
        )?;
    }

    Ok(())
}

fn persist_message(
    database_path: &Path,
    session_id: &str,
    role: &str,
    content: &str,
    files: Option<&[String]>,
    blocks: Option<&Value>,
) -> Result<()> {
    let connection = Connection::open(database_path)?;
    connection.execute(
        "INSERT INTO messages (id, session_id, role, content, files, blocks, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
        params![
            Uuid::new_v4().to_string(),
            session_id,
            role,
            content,
            files.map(serde_json::to_string).transpose()?,
            blocks.map(|value| value.to_string())
        ],
    )?;
    connection.execute(
        "UPDATE sessions
         SET updated_at = datetime('now')
         WHERE id = ?1",
        params![session_id],
    )?;
    Ok(())
}

fn load_history_rows(
    database_path: &Path,
    session_id: &str,
    limit: usize,
) -> Result<Vec<HistoryMessage>> {
    let connection = Connection::open(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, role, content, files, blocks, created_at
         FROM messages
         WHERE session_id = ?1
         ORDER BY rowid DESC
         LIMIT ?2",
    )?;

    let rows = statement.query_map(params![session_id, limit as i64], |row| {
        let role: String = row.get(1)?;
        let content: String = row.get(2)?;
        let raw_files: Option<String> = row.get(3)?;
        let raw_blocks: Option<String> = row.get(4)?;
        let files = raw_files
            .as_deref()
            .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok());
        let blocks = raw_blocks
            .as_deref()
            .and_then(|value| serde_json::from_str::<Value>(value).ok());
        Ok(HistoryMessage {
            id: row.get(0)?,
            role: role.clone(),
            text: (!content.is_empty() && role == "user")
                .then_some(content.clone())
                .or_else(|| (role == "assistant" && blocks.is_none()).then_some(content.clone())),
            files,
            blocks,
            created_at: row.get(5)?,
        })
    })?;

    let mut messages = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    messages.reverse();
    Ok(messages)
}

fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SETTINGS_FILE)
}

fn load_settings(app_data_dir: &Path) -> Result<DesktopSettings> {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return Ok(DesktopSettings::default());
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read settings file {}", path.display()))?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn save_settings(app_data_dir: &Path, settings: &DesktopSettings) -> Result<()> {
    let path = settings_path(app_data_dir);
    fs::write(&path, serde_json::to_vec_pretty(settings)?)
        .with_context(|| format!("failed to write settings file {}", path.display()))?;
    Ok(())
}

fn load_sessions_with_fallback(database_path: &Path) -> Result<Vec<SessionSummary>> {
    let connection = Connection::open(database_path)?;
    let mut sessions = load_session_rows(&connection)?;
    if sessions.is_empty() {
        sessions.push(create_session_row(&connection, "Session 1")?);
    }
    Ok(sessions)
}

fn refresh_session_summary(connection: &Connection, session_id: &str) -> Result<SessionSummary> {
    let mut sessions = load_session_rows_filtered(connection, Some(session_id))?;
    sessions
        .pop()
        .ok_or_else(|| anyhow::anyhow!("session not found"))
}

fn load_session_rows(connection: &Connection) -> Result<Vec<SessionSummary>> {
    load_session_rows_filtered(connection, None)
}

fn load_session_rows_filtered(
    connection: &Connection,
    session_id: Option<&str>,
) -> Result<Vec<SessionSummary>> {
    let mut statement = connection.prepare(
        "SELECT
            sessions.id,
            sessions.title,
            sessions.created_at,
            sessions.updated_at,
            (
                SELECT CASE
                    WHEN messages.blocks IS NOT NULL AND messages.blocks != '' THEN '[structured response]'
                    ELSE messages.content
                END
                FROM messages
                WHERE messages.session_id = sessions.id
                ORDER BY messages.rowid DESC
                LIMIT 1
            ) AS preview,
            (
                SELECT COUNT(*)
                FROM messages
                WHERE messages.session_id = sessions.id
            ) AS message_count
         FROM sessions
         WHERE (?1 IS NULL OR sessions.id = ?1)
         ORDER BY updated_at DESC, created_at DESC",
    )?;
    let rows = statement.query_map(params![session_id], |row| {
        let preview: Option<String> = row.get(4)?;
        Ok(SessionSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            preview: preview.map(|value| truncate_preview(&value)),
            message_count: row.get::<_, i64>(5)? as usize,
        })
    })?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn truncate_preview(value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = collapsed.chars().take(88).collect::<String>();
    if collapsed.chars().count() > 88 {
        preview.push_str("...");
    }
    preview
}

fn resolve_active_session_id(
    settings: &DesktopSettings,
    sessions: &[SessionSummary],
) -> Option<String> {
    if let Some(active_id) = &settings.active_session_id {
        if sessions.iter().any(|session| session.id == *active_id) {
            return Some(active_id.clone());
        }
    }
    sessions.first().map(|session| session.id.clone())
}

fn maybe_update_session_title(database_path: &Path, session_id: &str, text: &str) -> Result<()> {
    let connection = Connection::open(database_path)?;
    let current_title: String = connection.query_row(
        "SELECT title FROM sessions WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    if !current_title.starts_with(DEFAULT_SESSION_PREFIX) {
        return Ok(());
    }

    let next_title = derive_session_title(text, &current_title);
    connection.execute(
        "UPDATE sessions
         SET title = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        params![next_title, session_id],
    )?;
    Ok(())
}

fn emit_connection(app: &AppHandle, status: &str, detail: impl Into<String>) {
    let payload = ConnectionPayload {
        status: status.to_string(),
        detail: detail.into(),
    };
    let _ = app.emit("zeroclaw://connection-status", payload);
}

fn emit_socket_message(app: &AppHandle, envelope: &SocketEnvelope) {
    let _ = app.emit("zeroclaw://socket-message", envelope);
}

fn emit_tray_new_session(app: &AppHandle) {
    let _ = app.emit("zeroclaw://tray-new-session", ());
}

fn should_skip_entry(name: &str) -> bool {
    name.starts_with('.') || name == "target" || name == "node_modules"
}

fn read_workspace_tree(path: &Path, depth: usize) -> Result<Vec<FileNode>> {
    if depth > MAX_WORKSPACE_DEPTH {
        return Ok(Vec::new());
    }

    let mut entries = fs::read_dir(path)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            !should_skip_entry(&name)
        })
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| entry.file_name());

    let mut nodes = Vec::new();
    for entry in entries {
        let entry_path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let is_dir = metadata.is_dir();
        let children = if is_dir {
            Some(read_workspace_tree(&entry_path, depth + 1)?)
        } else {
            None
        };
        nodes.push(FileNode {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    Ok(nodes)
}

fn open_path_in_explorer(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        if path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        let status = command.status()?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("explorer exited with status {status}");
    }

    #[cfg(target_os = "macos")]
    {
        let status = if path.is_file() {
            Command::new("open").arg("-R").arg(path).status()?
        } else {
            Command::new("open").arg(path).status()?
        };
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("open exited with status {status}");
    }

    #[cfg(target_os = "linux")]
    {
        let target = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let status = Command::new("xdg-open").arg(target).status()?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("xdg-open exited with status {status}");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        anyhow::bail!("open_in_explorer is unsupported on this platform");
    }
}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.hide()?;
    }
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<()> {
    let show_item = MenuItemBuilder::with_id(TRAY_SHOW_ID, "Show Window").build(app)?;
    let hide_item = MenuItemBuilder::with_id(TRAY_HIDE_ID, "Hide Window").build(app)?;
    let new_session_item =
        MenuItemBuilder::with_id(TRAY_NEW_SESSION_ID, "New Session").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&hide_item)
        .item(&new_session_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("ZeroClaw Desktop")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => {
                let _ = show_main_window(app);
            }
            TRAY_HIDE_ID => {
                let _ = hide_main_window(app);
            }
            TRAY_NEW_SESSION_ID => {
                let _ = show_main_window(app);
                emit_tray_new_session(app);
            }
            TRAY_QUIT_ID => app.exit(0),
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
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    match window.is_visible() {
                        Ok(true) => {
                            let _ = window.hide();
                        }
                        Ok(false) => {
                            let _ = show_main_window(&app);
                        }
                        Err(_) => {
                            let _ = show_main_window(&app);
                        }
                    }
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

async fn socket_loop(app: AppHandle, state: AppState) {
    loop {
        emit_connection(&app, "waiting", "Waiting for ZeroClaw to start...");
        match connect_async(SOCKET_URL).await {
            Ok((stream, _)) => {
                emit_connection(&app, "connected", format!("Connected to {}", SOCKET_URL));
                let (mut writer, mut reader) = stream.split();
                let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                {
                    let mut guard = state.inner.socket_tx.lock().await;
                    *guard = Some(tx);
                }

                loop {
                    tokio::select! {
                        outbound = rx.recv() => {
                            let Some(outbound) = outbound else {
                                break;
                            };
                            if writer.send(Message::Text(outbound.into())).await.is_err() {
                                break;
                            }
                        }
                        inbound = reader.next() => {
                            match inbound {
                                Some(Ok(Message::Text(text))) => {
                                    let Ok(envelope) = serde_json::from_str::<SocketEnvelope>(&text) else {
                                        continue;
                                    };

                                    if envelope.message_type == "stream_end" {
                                        let session_id = {
                                            let guard = state.inner.active_session_id.lock().await;
                                            guard.clone()
                                        };
                                        let blocks = envelope.blocks.as_ref();
                                        if let Some(session_id) = session_id {
                                            let _ = persist_message(
                                                &state.inner.database_path,
                                                &session_id,
                                                "assistant",
                                                &text,
                                                None,
                                                blocks,
                                            );
                                        }
                                    } else if envelope.message_type == "text" {
                                        let session_id = {
                                            let guard = state.inner.active_session_id.lock().await;
                                            guard.clone()
                                        };
                                        if let Some(session_id) = session_id {
                                            let _ = persist_message(
                                                &state.inner.database_path,
                                                &session_id,
                                                "assistant",
                                                envelope.content.as_deref().unwrap_or(""),
                                                None,
                                                None,
                                            );
                                        }
                                    }

                                    emit_socket_message(&app, &envelope);
                                }
                                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                                _ => {}
                            }
                        }
                    }
                }
            }
            Err(error) => {
                emit_connection(&app, "disconnected", format!("Connection failed: {error}"));
            }
        }

        {
            let mut guard = state.inner.socket_tx.lock().await;
            *guard = None;
        }

        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

#[tauri::command]
async fn send_message(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
    files: Vec<String>,
) -> std::result::Result<(), String> {
    let payload = serde_json::to_string(&SocketOutbound {
        text: text.clone(),
        files: files.clone(),
        user: "local".to_string(),
    })
    .map_err(|error| error.to_string())?;

    let sender = {
        let guard = state.inner.socket_tx.lock().await;
        guard.clone()
    };

    let sender = sender.ok_or_else(|| "Tauri channel is not connected".to_string())?;
    sender
        .send(payload)
        .map_err(|_| "socket send failed".to_string())?;

    {
        let mut guard = state.inner.active_session_id.lock().await;
        *guard = Some(session_id.clone());
    }

    persist_message(
        &state.inner.database_path,
        &session_id,
        "user",
        &text,
        Some(&files),
        None,
    )
    .map_err(|error| error.to_string())?;
    maybe_update_session_title(&state.inner.database_path, &session_id, &text)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_workspace(path: String) -> std::result::Result<Vec<FileNode>, String> {
    let root = PathBuf::from(path);
    read_workspace_tree(&root, 1).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_file_content(path: String) -> std::result::Result<String, String> {
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let limited = if bytes.len() > MAX_FILE_BYTES {
        &bytes[..MAX_FILE_BYTES]
    } else {
        &bytes
    };
    String::from_utf8(limited.to_vec()).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> std::result::Result<(), String> {
    fs::write(&path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_in_explorer(path: String) -> std::result::Result<(), String> {
    open_path_in_explorer(Path::new(&path)).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_history(
    state: State<'_, AppState>,
    session_id: String,
    limit: usize,
) -> std::result::Result<Vec<HistoryMessage>, String> {
    load_history_rows(&state.inner.database_path, &session_id, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_sessions(state: State<'_, AppState>) -> std::result::Result<SessionBootstrap, String> {
    let settings = load_settings(&state.inner.app_data_dir).map_err(|error| error.to_string())?;
    let sessions = load_sessions_with_fallback(&state.inner.database_path)
        .map_err(|error| error.to_string())?;
    let active_session_id = resolve_active_session_id(&settings, &sessions)
        .ok_or_else(|| "no session available".to_string())?;
    Ok(SessionBootstrap {
        sessions,
        active_session_id,
    })
}

#[tauri::command]
fn create_session(state: State<'_, AppState>) -> std::result::Result<SessionSummary, String> {
    let connection =
        Connection::open(&state.inner.database_path).map_err(|error| error.to_string())?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let session = create_session_row(
        &connection,
        &format!("{DEFAULT_SESSION_PREFIX}{}", count + 1),
    )
    .map_err(|error| error.to_string())?;
    Ok(session)
}

#[tauri::command]
fn rename_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> std::result::Result<SessionSummary, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("session title cannot be empty".to_string());
    }
    let connection =
        Connection::open(&state.inner.database_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE sessions SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![trimmed, session_id],
        )
        .map_err(|error| error.to_string())?;
    refresh_session_summary(&connection, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<SessionBootstrap, String> {
    let connection =
        Connection::open(&state.inner.database_path).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id.clone()],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM sessions WHERE id = ?1",
            params![session_id.clone()],
        )
        .map_err(|error| error.to_string())?;

    let mut sessions = load_session_rows(&connection).map_err(|error| error.to_string())?;
    if sessions.is_empty() {
        sessions.push(
            create_session_row(&connection, &format!("{DEFAULT_SESSION_PREFIX}1"))
                .map_err(|error| error.to_string())?,
        );
    }

    let mut settings =
        load_settings(&state.inner.app_data_dir).map_err(|error| error.to_string())?;
    let next_active_session_id = resolve_active_session_id(&settings, &sessions)
        .ok_or_else(|| "no session available".to_string())?;
    settings.active_session_id = Some(next_active_session_id.clone());
    save_settings(&state.inner.app_data_dir, &settings).map_err(|error| error.to_string())?;
    Ok(SessionBootstrap {
        sessions,
        active_session_id: next_active_session_id,
    })
}

#[tauri::command]
fn show_main_window_command(app: AppHandle) -> std::result::Result<(), String> {
    show_main_window(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_active_session(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<(), String> {
    let mut settings =
        load_settings(&state.inner.app_data_dir).map_err(|error| error.to_string())?;
    settings.active_session_id = Some(session_id);
    save_settings(&state.inner.app_data_dir, &settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_workspace(state: State<'_, AppState>, path: String) -> std::result::Result<(), String> {
    let mut settings =
        load_settings(&state.inner.app_data_dir).map_err(|error| error.to_string())?;
    settings.workspace = Some(path);
    save_settings(&state.inner.app_data_dir, &settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_workspace_state(state: State<'_, AppState>) -> std::result::Result<WorkspaceState, String> {
    let settings = load_settings(&state.inner.app_data_dir).map_err(|error| error.to_string())?;
    let Some(workspace) = settings.workspace else {
        return Ok(WorkspaceState {
            workspace: None,
            tree: Vec::new(),
        });
    };

    let tree = read_workspace_tree(Path::new(&workspace), 1).map_err(|error| error.to_string())?;
    Ok(WorkspaceState {
        workspace: Some(workspace),
        tree,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let state = create_app_state(&app.handle())?;
            app.manage(state.clone());
            setup_tray(&app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(socket_loop(handle, state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_message,
            read_workspace,
            read_file_content,
            write_file_content,
            open_in_explorer,
            load_history,
            load_sessions,
            create_session,
            rename_session,
            delete_session,
            show_main_window_command,
            save_workspace,
            save_active_session,
            load_workspace_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
