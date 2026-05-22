/// Relay client — talks to the social-server running on localhost.
///
/// Responsibilities:
///   • register / authenticate on startup
///   • push outgoing messages and posts
///   • maintain a WebSocket and inject arriving messages into the local DB

use crate::db;
use ed25519_dalek::SigningKey;
use once_cell::sync::OnceCell;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::StreamExt;

pub static SERVER_URL: OnceCell<String> = OnceCell::new();
static SESSION_TOKEN: OnceCell<Mutex<Option<String>>> =
    OnceCell::new();

fn token() -> Option<String> {
    SESSION_TOKEN
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
        .clone()
}

fn set_token(t: String) {
    *SESSION_TOKEN
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap() = Some(t);
}

fn server() -> String {
    SERVER_URL
        .get()
        .cloned()
        .unwrap_or_else(|| "http://127.0.0.1:8080".into())
}

fn ws_server() -> String {
    server().replace("http://", "ws://").replace("https://", "wss://")
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct RegisterReq<'a> {
    user_id: &'a str,
    pubkey_hex: &'a str,
}

#[derive(Serialize)]
struct AuthReq<'a> {
    user_id: &'a str,
    timestamp: i64,
    signature_hex: String,
}

#[derive(Deserialize)]
struct AuthResp {
    token: String,
}

/// Register + authenticate with the server. Returns the session token.
pub async fn login(user_id: &str, pubkey_hex: &str, privkey_hex: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    // Register (idempotent)
    client
        .post(format!("{}/api/register", server()))
        .json(&RegisterReq { user_id, pubkey_hex })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Sign auth challenge
    let ts = now();
    let msg = format!("{}:{}", user_id, ts);
    let prv_bytes: [u8; 32] = hex::decode(privkey_hex)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "bad privkey".to_string())?;
    let signing_key = SigningKey::from_bytes(&prv_bytes);
    use ed25519_dalek::Signer;
    let sig = signing_key.sign(msg.as_bytes());
    let sig_hex = hex::encode(sig.to_bytes());

    let resp: AuthResp = client
        .post(format!("{}/api/auth", server()))
        .json(&AuthReq { user_id, timestamp: ts, signature_hex: sig_hex })
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    set_token(resp.token.clone());
    Ok(resp.token)
}

// ── Outgoing ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct SendMsgReq<'a> {
    recipient_id: &'a str,
    payload_hex: &'a str,
    nonce_hex: &'a str,
    msg_type: &'a str,
}

/// Push a DM to the server. `payload_hex` is the encrypted ciphertext.
/// For now we send plaintext hex-encoded; real E2E would encrypt with shared key first.
pub async fn send_message(
    recipient_id: &str,
    plaintext: &str,
    msg_type: &str,
) -> Result<(), String> {
    let tok = token().ok_or("not authenticated")?;
    // Encode plaintext as hex (placeholder — swap for real encryption later)
    let payload_hex = hex::encode(plaintext.as_bytes());
    let nonce_hex = "0".repeat(24); // placeholder nonce

    let client = reqwest::Client::new();
    client
        .post(format!("{}/api/messages", server()))
        .bearer_auth(tok)
        .json(&SendMsgReq { recipient_id, payload_hex: &payload_hex, nonce_hex: &nonce_hex, msg_type })
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct PublishPostReq {
    id: String,
    content: String,
    timestamp: i64,
    expires_at: Option<i64>,
    recipient_ids: Vec<String>,
}

/// Broadcast a post to all friends on the server.
pub async fn publish_post(
    id: &str,
    content: &str,
    timestamp: i64,
    expires_at: Option<i64>,
) -> Result<(), String> {
    let tok = token().ok_or("not authenticated")?;

    // Collect friend IDs from local DB
    let friend_ids: Vec<String> = {
        let db = db::get().lock().unwrap();
        let mut stmt = db
            .prepare("SELECT user_id FROM friends WHERE blocked_at IS NULL")
            .map_err(|e| e.to_string())?;
        let ids = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        ids
    };

    if friend_ids.is_empty() {
        return Ok(());
    }

    let client = reqwest::Client::new();
    client
        .post(format!("{}/api/posts", server()))
        .bearer_auth(tok)
        .json(&PublishPostReq {
            id: id.to_string(),
            content: content.to_string(),
            timestamp,
            expires_at,
            recipient_ids: friend_ids,
        })
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Friend management ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AddFriendReq<'a> {
    friend_id: &'a str,
    friend_pubkey_hex: &'a str,
}

/// Register a friend's pubkey on the server and record the friendship edge.
/// Called after `add_friend_from_qr` succeeds locally.
pub async fn notify_friendship(friend_id: &str, friend_pubkey_hex: &str) -> Result<(), String> {
    let tok = token().ok_or("not authenticated")?;
    let client = reqwest::Client::new();
    client
        .post(format!("{}/api/friends", server()))
        .bearer_auth(tok)
        .json(&AddFriendReq { friend_id, friend_pubkey_hex })
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Incoming (WebSocket listener) ─────────────────────────────────────────────

#[derive(Deserialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: String,
    // message fields
    id: Option<String>,
    sender_id: Option<String>,
    payload_hex: Option<String>,
    msg_type: Option<String>,
    sent_at: Option<i64>,
    // post fields
    author_id: Option<String>,
    content: Option<String>,
    timestamp: Option<i64>,
    expires_at: Option<i64>,
}

/// Spawn a background task that maintains the WebSocket and writes
/// incoming messages / posts directly into the local SQLite DB.
pub fn spawn_ws_listener(user_id: String) {
    tokio::spawn(async move {
        loop {
            if let Some(tok) = token() {
                let url = format!("{}/api/ws?token={}", ws_server(), tok);
                match connect_async(&url).await {
                    Ok((ws_stream, _)) => {
                        let (mut _write, mut read) = ws_stream.split();
                        while let Some(Ok(msg)) = read.next().await {
                            if let Message::Text(text) = msg {
                                handle_ws_message(&user_id, &text);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[relay] WS connect error: {e}");
                    }
                }
            }
            // Reconnect after 5 s
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    });
}

fn handle_ws_message(my_id: &str, text: &str) {
    let env: WsEnvelope = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(_) => return,
    };

    match env.kind.as_str() {
        "message" => {
            let Some(id) = env.id else { return };
            let Some(sender_id) = env.sender_id else { return };
            let Some(payload_hex) = env.payload_hex else { return };
            let msg_type = env.msg_type.unwrap_or_else(|| "dm".into());
            let ts = env.sent_at.unwrap_or_else(now);

            // Decode plaintext (placeholder — swap for decryption later)
            let plaintext = hex::decode(&payload_hex)
                .ok()
                .and_then(|b| String::from_utf8(b).ok())
                .unwrap_or(payload_hex);

            let db = db::get().lock().unwrap();
            match msg_type.as_str() {
                "dm" => {
                    let mut parts = [sender_id.as_str(), my_id];
                    parts.sort();
                    let convo_id = parts.join("-");
                    db.execute(
                        "INSERT OR IGNORE INTO messages
                         (id, conversation_id, sender_id, plaintext, timestamp, status)
                         VALUES (?1,?2,?3,?4,?5,'delivered')",
                        params![id, convo_id, sender_id, plaintext, ts],
                    ).ok();
                }
                "anon" => {
                    // anon messages carry thread_id as the message id prefix: "<thread_id>|<msg_id>"
                    if let Some((thread_id, msg_id)) = id.split_once('|') {
                        db.execute(
                            "INSERT OR IGNORE INTO anon_messages
                             (id, thread_id, plaintext, from_author, timestamp)
                             VALUES (?1,?2,?3,1,?4)",
                            params![msg_id, thread_id, plaintext, ts],
                        ).ok();
                    }
                }
                _ => {}
            }
        }
        "post" => {
            let Some(id) = env.id else { return };
            let Some(author_id) = env.author_id else { return };
            let Some(content) = env.content else { return };
            let ts = env.timestamp.unwrap_or_else(now);

            let db = db::get().lock().unwrap();
            db.execute(
                "INSERT OR IGNORE INTO posts
                 (id, author_id, content, timestamp, expires_at, is_own)
                 VALUES (?1,?2,?3,?4,?5,0)",
                params![id, author_id, content, ts, env.expires_at],
            ).ok();
        }
        _ => {}
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/// Called once from lib.rs after identity is confirmed.
pub async fn bootstrap(user_id: String, pubkey_hex: String, privkey_hex: String) {
    match login(&user_id, &pubkey_hex, &privkey_hex).await {
        Ok(_) => {
            eprintln!("[relay] authenticated as {}", user_id);
            spawn_ws_listener(user_id);
        }
        Err(e) => {
            eprintln!("[relay] server unreachable, running offline: {e}");
        }
    }
}
