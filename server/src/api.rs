use std::collections::HashMap;

use axum::Json;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::app::AppState;
use crate::auth::{AuthError, validate_registration, verify_auth_request};
use crate::db::models::{NewPendingMessage, NewPost};
use crate::db::repository;
use crate::wire::{
    AckPostRequest, AddFriendRequest, AuthRequest, AuthResponse, CreatePostRequest,
    MessageListResponse, PostListResponse, RegisterRequest, SendMessageRequest, ServerEnvelope,
};

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        #[derive(Serialize)]
        struct ErrorBody {
            error: String,
        }

        let (status, error) = match self {
            Self::BadRequest(error) => (StatusCode::BAD_REQUEST, error),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden".to_string()),
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            Self::Conflict(error) => (StatusCode::CONFLICT, error),
            Self::Internal(error) => (StatusCode::INTERNAL_SERVER_ERROR, error),
        };

        (status, Json(ErrorBody { error })).into_response()
    }
}

impl From<AuthError> for ApiError {
    fn from(value: AuthError) -> Self {
        match value {
            AuthError::MalformedPublicKey
            | AuthError::UserIdMismatch
            | AuthError::MalformedSignature => Self::BadRequest(value.to_string()),
            AuthError::UnknownUser
            | AuthError::TimestampOutsideWindow
            | AuthError::InvalidSignature => Self::Unauthorized,
        }
    }
}

fn now_ts() -> i64 {
    Utc::now().timestamp()
}

fn db_error(err: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(err.to_string())
}

fn authed_user(headers: &HeaderMap, state: &AppState) -> Result<String, ApiError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;

    state.user_for_token(token).ok_or(ApiError::Unauthorized)
}

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<StatusCode, ApiError> {
    validate_registration(&payload.user_id, &payload.pubkey_hex)?;

    let mut conn = state.pool.get().map_err(db_error)?;
    repository::register_user(&mut conn, &payload.user_id, &payload.pubkey_hex, now_ts())
        .map_err(db_error)?;

    Ok(StatusCode::CREATED)
}

pub async fn auth(
    State(state): State<AppState>,
    Json(payload): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    {
        let mut conn = state.pool.get().map_err(db_error)?;
        verify_auth_request(&mut conn, &payload, now_ts())?;
    }

    let token = Uuid::new_v4().to_string();
    state.put_session(token.clone(), payload.user_id);
    Ok(Json(AuthResponse { token }))
}

pub async fn post_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let sender_id = authed_user(&headers, &state)?;
    let envelope = ServerEnvelope::Message {
        id: payload.id.clone(),
        sender_id: sender_id.clone(),
        payload_hex: payload.payload_hex.clone(),
        nonce_hex: payload.nonce_hex.clone(),
        msg_type: payload.msg_type.clone(),
        sent_at: payload.sent_at,
    };

    if state.send_to_online(&payload.recipient_id, envelope.clone()) {
        let ack = ServerEnvelope::DeliveredAck {
            id: payload.id.clone(),
        };
        state.send_to_online(&sender_id, ack);
        return Ok(StatusCode::ACCEPTED);
    }

    let msg = NewPendingMessage {
        id: &payload.id,
        recipient_id: &payload.recipient_id,
        sender_id: &sender_id,
        payload_hex: &payload.payload_hex,
        nonce_hex: &payload.nonce_hex,
        msg_type: &payload.msg_type,
        sent_at: payload.sent_at,
    };

    let mut conn = state.pool.get().map_err(db_error)?;
    repository::enqueue_message(&mut conn, &msg).map_err(db_error)?;
    Ok(StatusCode::ACCEPTED)
}

pub async fn get_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MessageListResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let messages = repository::list_pending_messages(&mut conn, &user_id)
        .map_err(db_error)?
        .into_iter()
        .map(ServerEnvelope::from)
        .collect();

    Ok(Json(MessageListResponse { messages }))
}

pub async fn delete_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let deleted = repository::ack_message_for_recipient(&mut conn, &message_id, &user_id)
        .map_err(db_error)?;

    if deleted == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn post_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePostRequest>,
) -> Result<StatusCode, ApiError> {
    let author_id = authed_user(&headers, &state)?;
    let post = NewPost {
        id: &payload.id,
        author_id: &author_id,
        content: &payload.content,
        timestamp: payload.timestamp,
        expires_at: payload.expires_at,
    };
    let recipient_refs: Vec<&str> = payload.recipient_ids.iter().map(String::as_str).collect();

    {
        let mut conn = state.pool.get().map_err(db_error)?;
        repository::create_post_with_deliveries(&mut conn, &post, &recipient_refs)
            .map_err(db_error)?;
    }

    let envelope = ServerEnvelope::Post {
        id: payload.id.clone(),
        author_id,
        content: payload.content,
        timestamp: payload.timestamp,
        expires_at: payload.expires_at,
    };

    for recipient_id in payload.recipient_ids {
        if state.send_to_online(&recipient_id, envelope.clone()) {
            let mut conn = state.pool.get().map_err(db_error)?;
            repository::mark_post_delivered(&mut conn, &payload.id, &recipient_id, now_ts())
                .map_err(db_error)?;
        }
    }

    Ok(StatusCode::ACCEPTED)
}

pub async fn get_posts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PostListResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let posts = repository::list_pending_posts(&mut conn, &user_id, now_ts())
        .map_err(db_error)?
        .into_iter()
        .map(ServerEnvelope::from)
        .collect();

    Ok(Json(PostListResponse { posts }))
}

pub async fn ack_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AckPostRequest>,
) -> Result<StatusCode, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let updated = repository::mark_post_delivered(&mut conn, &payload.post_id, &user_id, now_ts())
        .map_err(db_error)?;

    if updated == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_friend(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AddFriendRequest>,
) -> Result<StatusCode, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let message_id = Uuid::new_v4().to_string();
    let sent_at = now_ts();
    let payload_hex = hex::encode(user_id.as_bytes());
    let nonce_hex = "000000000000000000000000".to_string();

    {
        let mut conn = state.pool.get().map_err(db_error)?;
        repository::add_friendship_pair(&mut conn, &user_id, &payload.friend_id, sent_at)
            .map_err(db_error)?;

        if !state.send_to_online(
            &payload.friend_id,
            ServerEnvelope::Message {
                id: message_id.clone(),
                sender_id: user_id.clone(),
                payload_hex: payload_hex.clone(),
                nonce_hex: nonce_hex.clone(),
                msg_type: "friend_added".to_string(),
                sent_at,
            },
        ) {
            let msg = NewPendingMessage {
                id: &message_id,
                recipient_id: &payload.friend_id,
                sender_id: &user_id,
                payload_hex: &payload_hex,
                nonce_hex: &nonce_hex,
                msg_type: "friend_added",
                sent_at,
            };
            repository::enqueue_message(&mut conn, &msg).map_err(db_error)?;
        }
    }

    Ok(StatusCode::ACCEPTED)
}

pub async fn ws_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let token = params.get("token").ok_or(ApiError::Unauthorized)?;
    let user_id = state.user_for_token(token).ok_or(ApiError::Unauthorized)?;

    Ok(ws
        .on_upgrade(move |socket| handle_socket(socket, state, user_id))
        .into_response())
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerEnvelope>();
    state.put_online(user_id.clone(), tx.clone());

    if let Ok(mut conn) = state.pool.get() {
        if let Ok(messages) = repository::list_pending_messages(&mut conn, &user_id) {
            for message in messages {
                let _ = tx.send(ServerEnvelope::from(message));
            }
        }

        if let Ok(posts) = repository::list_pending_posts(&mut conn, &user_id, now_ts()) {
            for post in posts {
                let _ = tx.send(ServerEnvelope::from(post));
            }
        }
    }

    loop {
        tokio::select! {
            Some(envelope) = rx.recv() => {
                match serde_json::to_string(&envelope) {
                    Ok(json) => {
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }

    state.remove_online(&user_id);
}
