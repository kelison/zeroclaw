use super::traits::{Channel, ChannelMessage, SendMessage};
use crate::config::schema::TauriChannelConfig;
use crate::util::truncate_with_ellipsis;
use anyhow::Context;
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct TauriInboundMessage {
    text: String,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default = "default_local_user")]
    user: String,
}

#[derive(Debug, Serialize)]
struct TauriOutboundMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    blocks: Option<Value>,
}

const TAURI_DRAFT_ID: &str = "tauri-draft";

fn default_local_user() -> String {
    "local".to_string()
}

pub struct TauriChannel {
    port: u16,
    workspace: PathBuf,
    allowed_users: Vec<String>,
    clients: Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<Message>>>>,
    next_client_id: AtomicU64,
    listening: Arc<AtomicBool>,
}

impl TauriChannel {
    pub fn new(config: TauriChannelConfig) -> Self {
        Self {
            port: config.port,
            workspace: PathBuf::from(config.workspace),
            allowed_users: config.allowed_users,
            clients: Arc::new(Mutex::new(HashMap::new())),
            next_client_id: AtomicU64::new(1),
            listening: Arc::new(AtomicBool::new(false)),
        }
    }

    fn is_user_allowed(&self, user: &str) -> bool {
        self.allowed_users
            .iter()
            .any(|allowed| allowed == "*" || allowed == user)
    }

    async fn broadcast_json(&self, payload: &Value) {
        let senders = {
            let clients = self.clients.lock().await;
            clients
                .iter()
                .map(|(id, tx)| (*id, tx.clone()))
                .collect::<Vec<_>>()
        };

        let mut stale = Vec::new();
        let serialized = payload.to_string();
        for (id, tx) in senders {
            if tx.send(Message::Text(serialized.clone().into())).is_err() {
                stale.push(id);
            }
        }

        if !stale.is_empty() {
            let mut clients = self.clients.lock().await;
            for id in stale {
                clients.remove(&id);
            }
        }
    }

    async fn remove_client(&self, client_id: u64) {
        self.clients.lock().await.remove(&client_id);
    }

    async fn sanitize_files(&self, files: &[String]) -> Vec<String> {
        let workspace = match tokio::fs::canonicalize(&self.workspace).await {
            Ok(path) => path,
            Err(_) => return Vec::new(),
        };

        let mut accepted = Vec::new();
        for file in files {
            let path = Path::new(file);
            if !path.is_absolute() {
                continue;
            }

            let Ok(canonical) = tokio::fs::canonicalize(path).await else {
                continue;
            };

            if canonical.starts_with(&workspace) {
                accepted.push(canonical.to_string_lossy().to_string());
            }
        }

        accepted
    }

    fn format_user_content(text: &str, files: &[String]) -> String {
        let trimmed = text.trim();
        if files.is_empty() {
            return trimmed.to_string();
        }

        let mut content = trimmed.to_string();
        if !content.is_empty() {
            content.push_str("\n\n");
        }
        content.push_str("Attached files:\n");
        for file in files {
            content.push_str("- ");
            content.push_str(file);
            content.push('\n');
        }
        content.trim_end().to_string()
    }

    fn parse_blocks_payload(content: &str) -> Option<Value> {
        let parsed = serde_json::from_str::<Value>(content).ok()?;
        match parsed {
            Value::Object(map) => {
                let blocks = map.get("blocks")?;
                blocks.is_array().then(|| blocks.clone())
            }
            Value::Array(_) => Some(parsed),
            _ => None,
        }
    }

    fn now_unix_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn outbound_text(content: &str) -> Value {
        Self::outbound_message("text", Some(content), None)
    }

    fn outbound_message(message_type: &str, content: Option<&str>, blocks: Option<Value>) -> Value {
        serde_json::to_value(TauriOutboundMessage {
            message_type,
            content,
            blocks: blocks.clone(),
        })
        .unwrap_or_else(|_| {
            let mut payload = json!({ "type": message_type });
            if let Some(content) = content {
                payload["content"] = json!(content);
            }
            if let Some(blocks) = blocks {
                payload["blocks"] = blocks;
            }
            payload
        })
    }

    async fn send_notification(&self, content: &str) {
        let summary = truncate_with_ellipsis(content.trim(), 120);
        if summary.is_empty() {
            return;
        }

        let payload = Self::outbound_message("notify", Some(&summary), None);
        self.broadcast_json(&payload).await;
    }

    async fn send_final_payload(&self, content: &str) {
        let payload = if let Some(blocks) = Self::parse_blocks_payload(content) {
            Self::outbound_message("stream_end", None, Some(blocks))
        } else {
            Self::outbound_text(content)
        };

        self.broadcast_json(&payload).await;
        self.send_notification(content).await;
    }
}

#[async_trait]
impl Channel for TauriChannel {
    fn name(&self) -> &str {
        "tauri"
    }

    async fn send(&self, message: &SendMessage) -> anyhow::Result<()> {
        self.send_final_payload(&message.content).await;
        Ok(())
    }

    async fn listen(&self, tx: mpsc::Sender<ChannelMessage>) -> anyhow::Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, self.port))
            .await
            .with_context(|| format!("failed to bind TauriChannel on 127.0.0.1:{}", self.port))?;
        self.listening.store(true, Ordering::SeqCst);

        loop {
            let (stream, _) = listener.accept().await?;
            let ws_stream = accept_async(stream)
                .await
                .context("tauri websocket handshake failed")?;
            let (mut writer, mut reader) = ws_stream.split();

            let client_id = self.next_client_id.fetch_add(1, Ordering::SeqCst);
            let (client_tx, mut client_rx) = mpsc::unbounded_channel::<Message>();

            self.clients
                .lock()
                .await
                .insert(client_id, client_tx.clone());

            tokio::spawn(async move {
                while let Some(message) = client_rx.recv().await {
                    if writer.send(message).await.is_err() {
                        break;
                    }
                }
            });

            let channel = TauriChannel {
                port: self.port,
                workspace: self.workspace.clone(),
                allowed_users: self.allowed_users.clone(),
                clients: Arc::clone(&self.clients),
                next_client_id: AtomicU64::new(self.next_client_id.load(Ordering::SeqCst)),
                listening: Arc::clone(&self.listening),
            };
            let tx_clone = tx.clone();

            tokio::spawn(async move {
                while let Some(frame) = reader.next().await {
                    match frame {
                        Ok(Message::Text(text)) => {
                            let inbound = match serde_json::from_str::<TauriInboundMessage>(&text) {
                                Ok(message) => message,
                                Err(err) => {
                                    let payload = TauriChannel::outbound_text(&format!(
                                        "Invalid Tauri payload: {err}"
                                    ));
                                    let _ =
                                        client_tx.send(Message::Text(payload.to_string().into()));
                                    continue;
                                }
                            };

                            if !channel.is_user_allowed(&inbound.user) {
                                let payload = TauriChannel::outbound_text(
                                    "User is not allowed to use the tauri channel.",
                                );
                                let _ = client_tx.send(Message::Text(payload.to_string().into()));
                                continue;
                            }

                            let files = channel.sanitize_files(&inbound.files).await;
                            let outbound = ChannelMessage {
                                id: Uuid::new_v4().to_string(),
                                sender: inbound.user.clone(),
                                reply_target: inbound.user,
                                content: TauriChannel::format_user_content(&inbound.text, &files),
                                channel: "tauri".to_string(),
                                timestamp: TauriChannel::now_unix_secs(),
                                thread_ts: None,
                            };

                            if tx_clone.send(outbound).await.is_err() {
                                break;
                            }
                        }
                        Ok(Message::Ping(payload)) => {
                            let _ = client_tx.send(Message::Pong(payload));
                        }
                        Ok(Message::Close(_)) | Err(_) => break,
                        _ => {}
                    }
                }

                channel.remove_client(client_id).await;
            });
        }
    }

    async fn health_check(&self) -> bool {
        self.listening.load(Ordering::SeqCst)
    }

    fn supports_draft_updates(&self) -> bool {
        true
    }

    async fn send_draft(&self, _message: &SendMessage) -> anyhow::Result<Option<String>> {
        Ok(Some(TAURI_DRAFT_ID.to_string()))
    }

    async fn update_draft(
        &self,
        _recipient: &str,
        _message_id: &str,
        text: &str,
    ) -> anyhow::Result<()> {
        let payload = Self::outbound_message("stream_chunk", Some(text), None);
        self.broadcast_json(&payload).await;
        Ok(())
    }

    async fn finalize_draft(
        &self,
        _recipient: &str,
        _message_id: &str,
        text: &str,
    ) -> anyhow::Result<()> {
        self.send_final_payload(text).await;
        Ok(())
    }

    async fn cancel_draft(&self, _recipient: &str, _message_id: &str) -> anyhow::Result<()> {
        let payload = Self::outbound_message("stream_chunk", Some(""), None);
        self.broadcast_json(&payload).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_blocks_payload_accepts_wrapper_object() {
        let blocks =
            TauriChannel::parse_blocks_payload(r#"{"blocks":[{"type":"text","content":"done"}]}"#)
                .expect("blocks");
        assert!(blocks.is_array());
        assert_eq!(blocks.as_array().expect("array").len(), 1);
    }

    #[test]
    fn parse_blocks_payload_rejects_non_blocks_json() {
        assert!(TauriChannel::parse_blocks_payload(r#"{"message":"hello"}"#).is_none());
    }

    #[test]
    fn format_user_content_appends_files() {
        let content = TauriChannel::format_user_content(
            "Review these files",
            &["C:/workspace/src/main.rs".to_string()],
        );
        assert!(content.contains("Review these files"));
        assert!(content.contains("Attached files:"));
        assert!(content.contains("C:/workspace/src/main.rs"));
    }

    #[test]
    fn wildcard_allowed_user_matches_any_sender() {
        let channel = TauriChannel {
            port: 7703,
            workspace: PathBuf::from("C:/workspace"),
            allowed_users: vec!["*".to_string()],
            clients: Arc::new(Mutex::new(HashMap::new())),
            next_client_id: AtomicU64::new(1),
            listening: Arc::new(AtomicBool::new(false)),
        };

        assert!(channel.is_user_allowed("local"));
        assert!(channel.is_user_allowed("someone"));
    }

    #[tokio::test]
    async fn update_draft_broadcasts_stream_chunk() {
        let channel = TauriChannel {
            port: 7703,
            workspace: PathBuf::from("C:/workspace"),
            allowed_users: vec!["*".to_string()],
            clients: Arc::new(Mutex::new(HashMap::new())),
            next_client_id: AtomicU64::new(1),
            listening: Arc::new(AtomicBool::new(false)),
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        channel.clients.lock().await.insert(1, tx);

        channel
            .update_draft("local", TAURI_DRAFT_ID, "partial text")
            .await
            .expect("update draft");

        let Message::Text(payload) = rx.recv().await.expect("stream chunk") else {
            panic!("expected text frame");
        };
        let payload: Value = serde_json::from_str(payload.as_ref()).expect("json payload");
        assert_eq!(payload["type"], "stream_chunk");
        assert_eq!(payload["content"], "partial text");
    }

    #[tokio::test]
    async fn finalize_draft_broadcasts_stream_end_for_blocks() {
        let channel = TauriChannel {
            port: 7703,
            workspace: PathBuf::from("C:/workspace"),
            allowed_users: vec!["*".to_string()],
            clients: Arc::new(Mutex::new(HashMap::new())),
            next_client_id: AtomicU64::new(1),
            listening: Arc::new(AtomicBool::new(false)),
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        channel.clients.lock().await.insert(1, tx);

        channel
            .finalize_draft(
                "local",
                TAURI_DRAFT_ID,
                r#"{"blocks":[{"type":"text","content":"done"}]}"#,
            )
            .await
            .expect("finalize draft");

        let Message::Text(payload) = rx.recv().await.expect("stream end") else {
            panic!("expected text frame");
        };
        let payload: Value = serde_json::from_str(payload.as_ref()).expect("json payload");
        assert_eq!(payload["type"], "stream_end");
        assert!(payload["blocks"].is_array());

        let Message::Text(notify) = rx.recv().await.expect("notify") else {
            panic!("expected text frame");
        };
        let notify: Value = serde_json::from_str(notify.as_ref()).expect("json payload");
        assert_eq!(notify["type"], "notify");
    }
}
