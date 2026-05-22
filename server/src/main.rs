mod auth;
mod db;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

// ── Live connection registry ──────────────────────────────────────────────────

type WsSender = mpsc::UnboundedSender<String>;
static LIVE: Lazy<Mutex<HashMap<String, WsSender>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn register_live(user_id: &str, tx: WsSender) {
    LIVE.lock().unwrap().insert(user_id.to_string(), tx);
}
fn unregister_live(user_id: &str) {
    LIVE.lock().unwrap().remove(user_id);
}
fn push_live(user_id: &str, payload: &str) -> bool {
    if let Some(tx) = LIVE.lock().unwrap().get(user_id) {
        tx.send(payload.to_string()).is_ok()
    } else {
        false
    }
}

// ── Shared state (empty — everything is global statics) ──────────────────────

#[derive(Clone)]
struct AppState;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn authed(headers: &HeaderMap) -> Result<String, Response> {
    let token = bearer(headers).ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"missing token"}))).into_response()
    })?;
    auth::resolve_token(&token).ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"invalid token"}))).into_response()
    })
}

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterReq {
    user_id: String,
    pubkey_hex: String,
}

#[derive(Deserialize)]
struct AuthReq {
    user_id: String,
    /// Unix timestamp (seconds) included in the signed message to prevent replay.
    timestamp: i64,
    /// hex(sign(user_id + ":" + timestamp))
    signature_hex: String,
}

#[derive(Serialize)]
struct AuthResp {
    token: String,
}

#[derive(Deserialize)]
struct SendMessageReq {
    recipient_id: String,
    payload_hex: String,
    nonce_hex: String,
    #[serde(default = "default_dm")]
    msg_type: String,
}
fn default_dm() -> String { "dm".into() }

#[derive(Deserialize)]
struct AckReq {
    message_id: String,
}

#[derive(Deserialize)]
struct PublishPostReq {
    id: String,
    content: String,
    timestamp: i64,
    expires_at: Option<i64>,
    recipient_ids: Vec<String>,
}

#[derive(Deserialize)]
struct AckPostReq {
    post_id: String,
}

#[derive(Deserialize)]
struct AddFriendReq {
    friend_id: String,
    friend_pubkey_hex: String,
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn register(
    Json(body): Json<RegisterReq>,
) -> Result<impl IntoResponse, Response> {
    db::upsert_user(&body.user_id, &body.pubkey_hex, now())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    info!("registered {}", body.user_id);
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn authenticate(
    Json(body): Json<AuthReq>,
) -> Result<impl IntoResponse, Response> {
    // Reject if timestamp is stale (±5 min)
    let delta = (now() - body.timestamp).abs();
    if delta > 300 {
        return Err((StatusCode::UNAUTHORIZED, "stale timestamp").into_response());
    }

    let pubkey = db::get_pubkey(&body.user_id)
        .map_err(|_| (StatusCode::NOT_FOUND, "user not found").into_response())?;

    let msg = format!("{}:{}", body.user_id, body.timestamp);
    auth::verify_signature(&pubkey, msg.as_bytes(), &body.signature_hex)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e).into_response())?;

    let token = auth::create_session(&body.user_id);
    info!("auth ok: {}", body.user_id);
    Ok(Json(AuthResp { token }))
}

async fn send_message(
    headers: HeaderMap,
    Json(body): Json<SendMessageReq>,
) -> Result<impl IntoResponse, Response> {
    let sender_id = authed(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();

    db::queue_message(
        &id, &sender_id, &body.recipient_id,
        &body.payload_hex, &body.nonce_hex, &body.msg_type, now(),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;

    // Try to push to live WebSocket connection immediately
    let envelope = serde_json::json!({
        "type": "message",
        "id": id,
        "sender_id": sender_id,
        "payload_hex": body.payload_hex,
        "nonce_hex": body.nonce_hex,
        "msg_type": body.msg_type,
        "sent_at": now(),
    });
    if push_live(&body.recipient_id, &envelope.to_string()) {
        info!("msg {} from {} → {} delivered live", id, sender_id, body.recipient_id);
        // Delivered live — remove from queue and ack back to sender
        db::ack_message(&id, &body.recipient_id).ok();
        let ack = serde_json::json!({"type": "delivered_ack", "id": id});
        push_live(&sender_id, &ack.to_string());
    } else {
        info!("msg {} from {} → {} queued (offline)", id, sender_id, body.recipient_id);
    }

    Ok(Json(serde_json::json!({"id": id})))
}

async fn get_pending_messages(
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let user_id = authed(&headers)?;
    let msgs = db::pull_pending_messages(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    info!("pull messages for {}: {} pending", user_id, msgs.len());
    Ok(Json(msgs))
}

async fn ack_message_handler(
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let user_id = authed(&headers)?;
    db::ack_message(&id, &user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    info!("ack msg {} by {}", id, user_id);
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn publish_post(
    headers: HeaderMap,
    Json(body): Json<PublishPostReq>,
) -> Result<impl IntoResponse, Response> {
    let author_id = authed(&headers)?;
    db::publish_post(
        &body.id, &author_id, &body.content,
        body.timestamp, body.expires_at, &body.recipient_ids,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;

    info!("post {} from {} → {} recipient(s)", body.id, author_id, body.recipient_ids.len());

    // Push to any online recipients
    let envelope = serde_json::json!({
        "type": "post",
        "id": body.id,
        "author_id": author_id,
        "content": body.content,
        "timestamp": body.timestamp,
        "expires_at": body.expires_at,
    });
    for rid in &body.recipient_ids {
        if push_live(rid, &envelope.to_string()) {
            info!("post {} delivered live to {}", body.id, rid);
            db::ack_post(&body.id, rid).ok();
        } else {
            info!("post {} queued for {} (offline)", body.id, rid);
        }
    }

    Ok(Json(serde_json::json!({"ok": true})))
}

async fn get_pending_posts(
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let user_id = authed(&headers)?;
    let posts = db::pull_pending_posts(&user_id, now())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    info!("pull posts for {}: {} pending", user_id, posts.len());
    Ok(Json(posts))
}

async fn ack_post_handler(
    headers: HeaderMap,
    Json(body): Json<AckPostReq>,
) -> Result<impl IntoResponse, Response> {
    let user_id = authed(&headers)?;
    db::ack_post(&body.post_id, &user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    info!("ack post {} by {}", body.post_id, user_id);
    Ok(Json(serde_json::json!({"ok": true})))
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

async fn add_friend(
    headers: HeaderMap,
    Json(body): Json<AddFriendReq>,
) -> Result<impl IntoResponse, Response> {
    let user_id = authed(&headers)?;
    // Register the friend's pubkey so the server can route messages to them
    db::upsert_user(&body.friend_id, &body.friend_pubkey_hex, now())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    // Record the directed edge user → friend
    db::add_friendship(&user_id, &body.friend_id, now())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response())?;
    info!("friendship: {} → {}", user_id, body.friend_id);
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
) -> Response {
    let user_id = match auth::resolve_token(&q.token) {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "invalid token").into_response(),
    };
    ws.on_upgrade(move |socket| handle_socket(socket, user_id))
}

async fn handle_socket(mut socket: WebSocket, user_id: String) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    register_live(&user_id, tx);
    info!("WS connected: {}", user_id);

    // Drain any pending messages and posts on connect
    if let Ok(msgs) = db::pull_pending_messages(&user_id) {
        if !msgs.is_empty() {
            info!("draining {} queued message(s) to {}", msgs.len(), user_id);
        }
        for m in msgs {
            let env = serde_json::json!({
                "type": "message",
                "id": m.id,
                "sender_id": m.sender_id,
                "payload_hex": m.payload_hex,
                "nonce_hex": m.nonce_hex,
                "msg_type": m.msg_type,
                "sent_at": m.sent_at,
            });
            if socket.send(Message::Text(env.to_string())).await.is_err() {
                break;
            }
            db::ack_message(&m.id, &user_id).ok();
        }
    }
    if let Ok(posts) = db::pull_pending_posts(&user_id, now()) {
        for p in posts {
            let env = serde_json::json!({
                "type": "post",
                "id": p.id,
                "author_id": p.author_id,
                "content": p.content,
                "timestamp": p.timestamp,
                "expires_at": p.expires_at,
            });
            if socket.send(Message::Text(env.to_string())).await.is_err() {
                break;
            }
            db::ack_post(&p.id, &user_id).ok();
        }
    }

    // Pump outgoing pushes and keep connection alive
    loop {
        tokio::select! {
            Some(msg) = rx.recv() => {
                if socket.send(Message::Text(msg)).await.is_err() { break; }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Text(t))) => {
                        info!("WS message from {}: {}", user_id, t);
                    }
                    Some(Err(e)) => {
                        info!("WS error from {}: {}", user_id, e);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    unregister_live(&user_id);
    info!("WS disconnected: {}", user_id);
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("social_server=debug,info")
        .init();

    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| ".".into());
    std::fs::create_dir_all(&data_dir).ok();
    let db_path = format!("{}/server.db", data_dir);

    db::init(&db_path).expect("failed to open server DB");
    info!("database: {}", db_path);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/register",           post(register))
        .route("/api/auth",               post(authenticate))
        .route("/api/messages",           post(send_message))
        .route("/api/messages",           get(get_pending_messages))
        .route("/api/messages/:id",       delete(ack_message_handler))
        .route("/api/posts",              post(publish_post))
        .route("/api/posts",              get(get_pending_posts))
        .route("/api/posts/ack",          post(ack_post_handler))
        .route("/api/friends",            post(add_friend))
        .route("/api/ws",                 get(ws_handler))
        .layer(cors)
        .with_state(AppState);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    info!("listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
