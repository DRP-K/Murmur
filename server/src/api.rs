use std::collections::HashMap;

use axum::Json;
use axum::extract::Multipart;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::app::AppState;
use crate::auth::{AuthError, validate_registration, verify_auth_request};
use crate::bot_ai::{self, ChatMessage};
use crate::db::models::{NewGroup, NewGroupMember, NewGroupMessage, NewPendingMessage, NewPost};
use crate::db::repository;
use crate::seed;
use crate::wire::{
    AckGroupMessageRequest, AckPostRequest, AddFriendRequest, AuthRequest, AuthResponse,
    CreatePostRequest, FriendInfo, FriendListResponse, GroupInfo, GroupListResponse,
    GroupMessageListResponse, InviteTokenResponse, MediaUploadResponse, MessageListResponse,
    PostAssistRequest, PostAssistResponse, PostListResponse, RedeemInviteTokenRequest,
    RegisterRequest, SendGroupMessageRequest, SendMessageRequest, ServerEnvelope,
};

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict(String),
    ServiceUnavailable(String),
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
            Self::ServiceUnavailable(error) => (StatusCode::SERVICE_UNAVAILABLE, error),
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

pub fn now_ts() -> i64 {
    Utc::now().timestamp()
}

fn db_error(err: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(err.to_string())
}

fn authed_user(headers: &HeaderMap, state: &AppState) -> Result<String, ApiError> {
    // Bearer token session lookup.
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

    let use_ai = state.deepseek_api_key.is_some();
    let mut conn = state.pool.get().map_err(db_error)?;
    repository::register_user(&mut conn, &payload.user_id, &payload.pubkey_hex, now_ts())
        .map_err(db_error)?;

    seed::seed_for_new_user(&mut conn, &payload.user_id, use_ai);
    drop(conn);

    if use_ai {
        let api_key = state.deepseek_api_key.clone().unwrap();
        let new_user_id = payload.user_id.clone();
        let bot_ids = bot_ai::bot_user_ids();
        for bot_id in bot_ids {
            if let Some(persona) = bot_ai::persona_for_bot_id(&bot_id) {
                let state_c = state.clone();
                let api_key_c = api_key.clone();
                let bot_id_c = bot_id.clone();
                let user_id_c = new_user_id.clone();
                tokio::spawn(async move {
                    let text =
                        bot_ai::generate_welcome(&state_c.http_client, &api_key_c, persona).await;
                    let text = match text {
                        Some(t) => t,
                        None => {
                            warn!(bot_id = %bot_id_c, "deepseek welcome generation failed, skipping");
                            return;
                        }
                    };
                    let sent_at = chrono::Utc::now().timestamp();
                    let dm_id = format!("ai:{bot_id_c}:{user_id_c}:welcome");
                    let payload_hex = hex::encode(text.as_bytes());
                    let msg = NewPendingMessage {
                        id: &dm_id,
                        recipient_id: &user_id_c,
                        sender_id: &bot_id_c,
                        payload_hex: &payload_hex,
                        nonce_hex: "000000000000000000000000",
                        msg_type: "dm",
                        sent_at: sent_at + 2,
                    };
                    match state_c.pool.get() {
                        Ok(mut conn) => {
                            if let Err(e) = repository::enqueue_message(&mut conn, &msg) {
                                warn!(msg_id = %dm_id, error = %e, "ai welcome enqueue failed");
                            } else {
                                let envelope = ServerEnvelope::Message {
                                    id: dm_id,
                                    sender_id: bot_id_c.clone(),
                                    payload_hex,
                                    nonce_hex: "000000000000000000000000".to_string(),
                                    msg_type: "dm".to_string(),
                                    sent_at: sent_at + 2,
                                };
                                state_c.send_to_online(&user_id_c, envelope);
                                info!(bot_id = %bot_id_c, user_id = %user_id_c, "ai welcome sent");
                            }
                        }
                        Err(e) => warn!(error = %e, "ai welcome: db pool acquire failed"),
                    }
                });
            }
        }
    }

    info!(user_id = %payload.user_id, "user registered");
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
    info!("auth session issued");
    Ok(Json(AuthResponse { token }))
}

pub async fn post_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let sender_id = authed_user(&headers, &state)?;
    info!(
        message_id = %payload.id,
        sender_id = %sender_id,
        recipient_id = %payload.recipient_id,
        msg_type = %payload.msg_type,
        "message send requested"
    );
    let envelope = ServerEnvelope::Message {
        id: payload.id.clone(),
        sender_id: sender_id.clone(),
        payload_hex: payload.payload_hex.clone(),
        nonce_hex: payload.nonce_hex.clone(),
        msg_type: payload.msg_type.clone(),
        sent_at: payload.sent_at,
    };

    // Always persist first — delivery is at-least-once.
    // The recipient must explicitly ack (DELETE /api/messages/:id) to clear.
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
    drop(conn);

    if state.send_to_online(&payload.recipient_id, envelope) {
        let ack = ServerEnvelope::DeliveredAck {
            id: payload.id.clone(),
        };
        state.send_to_online(&sender_id, ack);
        info!(
            message_id = %payload.id,
            recipient_id = %payload.recipient_id,
            "message delivered live, pending client ack"
        );
    } else {
        info!(
            message_id = %payload.id,
            recipient_id = %payload.recipient_id,
            "message queued for offline recipient"
        );
    }

    // If the recipient is a bot and DeepSeek is configured, generate a reply.
    if payload.msg_type == "dm"
        && bot_ai::is_bot_id(&payload.recipient_id)
        && state.deepseek_api_key.is_some()
    {
        if let Some(persona) = bot_ai::persona_for_bot_id(&payload.recipient_id) {
            let decoded_text = hex::decode(&payload.payload_hex)
                .ok()
                .and_then(|b| String::from_utf8(b).ok());

            if let Some(user_text) = decoded_text {
                let bot_id = payload.recipient_id.clone();
                let user_id = sender_id.clone();

                // Append the incoming user message to history, then snapshot for the task.
                let history_snapshot = {
                    let mut guard = state.conversation_history.write().unwrap();
                    let history = guard.entry((bot_id.clone(), user_id.clone())).or_default();
                    history.push(ChatMessage {
                        role: "user",
                        content: user_text,
                    });
                    history.clone()
                };

                let state_c = state.clone();
                let api_key = state.deepseek_api_key.clone().unwrap();
                tokio::spawn(async move {
                    let reply = bot_ai::generate_reply(
                        &state_c.http_client,
                        &api_key,
                        persona,
                        &history_snapshot,
                    )
                    .await;
                    let reply = match reply {
                        Some(r) => r,
                        None => {
                            warn!(bot_id = %bot_id, "deepseek reply generation failed");
                            return;
                        }
                    };

                    // Append the assistant reply to history.
                    {
                        let mut guard = state_c.conversation_history.write().unwrap();
                        let history = guard.entry((bot_id.clone(), user_id.clone())).or_default();
                        history.push(ChatMessage {
                            role: "assistant",
                            content: reply.clone(),
                        });
                    }

                    let sent_at = chrono::Utc::now().timestamp();
                    let reply_id = format!("ai:reply:{}:{}", bot_id, Uuid::new_v4());
                    let payload_hex = hex::encode(reply.as_bytes());
                    let reply_msg = NewPendingMessage {
                        id: &reply_id,
                        recipient_id: &user_id,
                        sender_id: &bot_id,
                        payload_hex: &payload_hex,
                        nonce_hex: "000000000000000000000000",
                        msg_type: "dm",
                        sent_at,
                    };
                    match state_c.pool.get() {
                        Ok(mut conn) => {
                            if let Err(e) = repository::enqueue_message(&mut conn, &reply_msg) {
                                warn!(reply_id = %reply_id, error = %e, "ai reply enqueue failed");
                            } else {
                                let envelope = ServerEnvelope::Message {
                                    id: reply_id,
                                    sender_id: bot_id.clone(),
                                    payload_hex,
                                    nonce_hex: "000000000000000000000000".to_string(),
                                    msg_type: "dm".to_string(),
                                    sent_at,
                                };
                                state_c.send_to_online(&user_id, envelope);
                                info!(bot_id = %bot_id, user_id = %user_id, "ai reply sent");
                            }
                        }
                        Err(e) => warn!(error = %e, "ai reply: db pool acquire failed"),
                    }
                });
            }
        }
    }

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

    debug!(user_id = %user_id, "pending messages fetched");
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
        warn!(user_id = %user_id, message_id = %message_id, "message ack missed");
        return Err(ApiError::NotFound);
    }

    info!(user_id = %user_id, message_id = %message_id, "message acked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn post_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePostRequest>,
) -> Result<StatusCode, ApiError> {
    let author_id = authed_user(&headers, &state)?;
    info!(
        post_id = %payload.id,
        author_id = %author_id,
        recipients = payload.recipient_ids.len(),
        "post publish requested"
    );
    let attachments_json: Option<String> = payload
        .attachments
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());
    if let Some(rally) = &payload.rally {
        if rally.max_members < 2 || rally.max_members > 20 {
            return Err(ApiError::BadRequest(
                "rally max_members must be between 2 and 20".to_string(),
            ));
        }
        if rally.group_id.trim().is_empty() {
            return Err(ApiError::BadRequest(
                "rally group_id is required".to_string(),
            ));
        }
    }
    let post = NewPost {
        id: &payload.id,
        author_id: &author_id,
        content: &payload.content,
        timestamp: payload.timestamp,
        category: payload.category.as_deref(),
        media_ref_name: payload.media_ref_name.as_deref(),
        image_url: payload.image_url.as_deref(),
        attachment_url: payload.attachment_url.as_deref(),
        attachment_type: payload.attachment_type.as_deref(),
        attachments: attachments_json.as_deref(),
        rally_group_id: payload.rally.as_ref().map(|r| r.group_id.as_str()),
        rally_max_members: payload.rally.as_ref().map(|r| r.max_members),
    };
    let recipient_refs: Vec<&str> = payload.recipient_ids.iter().map(String::as_str).collect();

    {
        let mut conn = state.pool.get().map_err(db_error)?;
        if let Some(rally) = &payload.rally {
            let title = payload.content.chars().take(48).collect::<String>();
            let group = NewGroup {
                id: &rally.group_id,
                creator_id: &author_id,
                title: &title,
                max_members: rally.max_members,
                created_at: payload.timestamp,
            };
            let creator_member = NewGroupMember {
                group_id: &rally.group_id,
                user_id: &author_id,
                joined_at: payload.timestamp,
            };
            repository::create_rally_post_with_deliveries(
                &mut conn,
                &post,
                &recipient_refs,
                &group,
                &creator_member,
            )
            .map_err(|e| {
                error!(post_id = %payload.id, error = %e, "db insert failed for post");
                db_error(e)
            })?;
        } else {
            repository::create_post_with_deliveries(&mut conn, &post, &recipient_refs).map_err(
                |e| {
                    error!(post_id = %payload.id, error = %e, "db insert failed for post");
                    db_error(e)
                },
            )?;
        }
    }

    let envelope = ServerEnvelope::Post {
        id: payload.id.clone(),
        author_id,
        content: payload.content,
        timestamp: payload.timestamp,
        category: payload.category,
        media_ref_name: payload.media_ref_name,
        image_url: payload.image_url,
        attachment_url: payload.attachment_url,
        attachment_type: payload.attachment_type,
        attachments: payload.attachments,
        rally_group_id: payload.rally.as_ref().map(|r| r.group_id.clone()),
        rally_max_members: payload.rally.as_ref().map(|r| r.max_members),
    };

    for recipient_id in payload.recipient_ids {
        if state.send_to_online(&recipient_id, envelope.clone()) {
            info!(
                post_id = %payload.id,
                recipient_id = %recipient_id,
                "post notified live (pending client ack)"
            );
        } else {
            debug!(
                post_id = %payload.id,
                recipient_id = %recipient_id,
                "post remains pending"
            );
        }
    }

    info!(post_id = %payload.id, "post fanout recorded");
    Ok(StatusCode::ACCEPTED)
}

pub async fn post_assist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PostAssistRequest>,
) -> Result<Json<PostAssistResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let prefix = payload.prefix.trim();
    if prefix.split_whitespace().count() < 2 {
        return Err(ApiError::BadRequest(
            "type at least a few words before asking for expansion".to_string(),
        ));
    }

    let Some(api_key) = state.deepseek_api_key.clone() else {
        return Err(ApiError::ServiceUnavailable(
            "post expansion is not configured".to_string(),
        ));
    };

    let suggestion = bot_ai::generate_post_assist(&state.http_client, &api_key, prefix)
        .await
        .ok_or_else(|| ApiError::Internal("post expansion failed".to_string()))?;
    info!(user_id = %user_id, "post expansion generated");
    Ok(Json(suggestion))
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

    debug!(user_id = %user_id, "pending posts fetched");
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
        warn!(user_id = %user_id, post_id = %payload.post_id, "post ack missed");
        return Err(ApiError::NotFound);
    }

    info!(user_id = %user_id, post_id = %payload.post_id, "post acked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_groups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<GroupListResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let groups = repository::list_groups_for_user(&mut conn, &user_id)
        .map_err(db_error)?
        .into_iter()
        .map(|(group, members)| GroupInfo::from_group(group, members))
        .collect();
    Ok(Json(GroupListResponse { groups }))
}

pub async fn join_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
) -> Result<Json<GroupInfo>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let (group, members, inserted) =
        repository::join_group_if_space(&mut conn, &group_id, &user_id, now_ts()).map_err(|e| {
            if matches!(e, diesel::result::Error::RollbackTransaction) {
                ApiError::Conflict("group is full".to_string())
            } else if matches!(e, diesel::result::Error::NotFound) {
                ApiError::NotFound
            } else {
                db_error(e)
            }
        })?;
    if inserted {
        info!(group_id = %group_id, user_id = %user_id, "user joined group");
    }
    let group_info = GroupInfo::from_group(group, members);
    if inserted {
        for member in &group_info.members {
            if member.user_id == user_id {
                continue;
            }
            state.send_to_online(
                &member.user_id,
                ServerEnvelope::GroupUpdate {
                    group: group_info.clone(),
                },
            );
        }
    }
    Ok(Json(group_info))
}

pub async fn get_group_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
) -> Result<Json<GroupMessageListResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    if !repository::is_group_member(&mut conn, &group_id, &user_id).map_err(db_error)? {
        return Err(ApiError::Forbidden);
    }
    let messages =
        repository::list_pending_group_messages_for_group(&mut conn, &group_id, &user_id)
            .map_err(db_error)?
            .into_iter()
            .map(ServerEnvelope::from)
            .collect();
    Ok(Json(GroupMessageListResponse { messages }))
}

pub async fn post_group_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
    Json(payload): Json<SendGroupMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let sender_id = authed_user(&headers, &state)?;
    let message = NewGroupMessage {
        id: &payload.id,
        group_id: &group_id,
        sender_id: &sender_id,
        payload_hex: &payload.payload_hex,
        sent_at: payload.sent_at,
    };
    let recipients = {
        let mut conn = state.pool.get().map_err(db_error)?;
        repository::create_group_message_with_deliveries(&mut conn, &message).map_err(|e| {
            if matches!(e, diesel::result::Error::NotFound) {
                ApiError::Forbidden
            } else {
                db_error(e)
            }
        })?
    };

    let envelope = ServerEnvelope::GroupMessage {
        id: payload.id.clone(),
        group_id: group_id.clone(),
        sender_id,
        payload_hex: payload.payload_hex,
        sent_at: payload.sent_at,
    };
    for recipient_id in recipients {
        state.send_to_online(&recipient_id, envelope.clone());
    }
    Ok(StatusCode::ACCEPTED)
}

pub async fn ack_group_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(_group_id): Path<String>,
    Json(payload): Json<AckGroupMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let updated = repository::mark_group_message_delivered(
        &mut conn,
        &payload.message_id,
        &user_id,
        now_ts(),
    )
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

    let mut conn = state.pool.get().map_err(db_error)?;
    let sender = repository::get_user(&mut conn, &user_id).map_err(db_error)?;
    let payload_json = serde_json::json!({
        "user_id": user_id,
        "pubkey_hex": sender.pubkey_hex,
    });
    let payload_hex = hex::encode(payload_json.to_string().as_bytes());
    let nonce_hex = "000000000000000000000000".to_string();

    {
        repository::add_friendship_pair(&mut conn, &user_id, &payload.friend_id, sent_at)
            .map_err(db_error)?;
        info!(
            user_id = %user_id,
            friend_id = %payload.friend_id,
            "friendship pair recorded"
        );

        // Always enqueue — at-least-once delivery.
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

        if state.send_to_online(
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
            info!(
                user_id = %user_id,
                friend_id = %payload.friend_id,
                "friend_added notification delivered live, pending client ack"
            );
        } else {
            info!(
                user_id = %user_id,
                friend_id = %payload.friend_id,
                "friend_added notification queued for offline recipient"
            );
        }
    }

    Ok(StatusCode::ACCEPTED)
}

pub async fn get_friends(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<FriendListResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    let mut conn = state.pool.get().map_err(db_error)?;
    let rows = repository::list_friends_for_user(&mut conn, &user_id).map_err(db_error)?;
    let friends: Vec<FriendInfo> = rows
        .into_iter()
        .map(|(friend_id, pubkey_hex, created_at)| FriendInfo {
            user_id: friend_id,
            pubkey_hex,
            created_at,
        })
        .collect();
    debug!(user_id = %user_id, count = friends.len(), "friends listed");
    Ok(Json(FriendListResponse { friends }))
}

pub async fn upload_media(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<MediaUploadResponse>, ApiError> {
    let user_id = authed_user(&headers, &state)?;
    info!(user_id = %user_id, "media upload started");

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        warn!(user_id = %user_id, error = %e, "multipart field read failed");
        ApiError::BadRequest(e.to_string())
    })? {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name != "file" {
            debug!(user_id = %user_id, field = %field_name, "skipping non-file multipart field");
            continue;
        }

        let content_type = field.content_type().unwrap_or("").to_string();
        debug!(user_id = %user_id, content_type = %content_type, "file field found");

        let (media_type, ext) = match content_type.as_str() {
            "image/jpeg" => ("image", "jpg"),
            "image/png" => ("image", "png"),
            "image/gif" => ("image", "gif"),
            "image/webp" => ("image", "webp"),
            "video/mp4" => ("video", "mp4"),
            "video/webm" => ("video", "webm"),
            _ => {
                warn!(user_id = %user_id, content_type = %content_type, "unsupported media type rejected");
                return Err(ApiError::BadRequest("unsupported media type".into()));
            }
        };

        let max_bytes: usize = if media_type == "image" {
            10 * 1024 * 1024
        } else {
            50 * 1024 * 1024
        };

        let data = field.bytes().await.map_err(|e| {
            warn!(user_id = %user_id, error = %e, "failed to read file bytes from multipart");
            ApiError::BadRequest(e.to_string())
        })?;

        debug!(user_id = %user_id, bytes = data.len(), max_bytes, "file bytes read");

        if data.len() > max_bytes {
            warn!(user_id = %user_id, bytes = data.len(), max_bytes, "file too large");
            return Err(ApiError::BadRequest("file too large".into()));
        }

        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        let uploads_dir = std::env::var("UPLOADS_DIR").unwrap_or_else(|_| "uploads".into());

        tokio::fs::create_dir_all(&uploads_dir)
            .await
            .map_err(|e| {
                error!(user_id = %user_id, dir = %uploads_dir, error = %e, "failed to create uploads directory");
                ApiError::Internal(e.to_string())
            })?;

        tokio::fs::write(
            std::path::Path::new(&uploads_dir).join(&filename),
            &data,
        )
        .await
        .map_err(|e| {
            error!(user_id = %user_id, filename = %filename, error = %e, "failed to write uploaded file");
            ApiError::Internal(e.to_string())
        })?;

        info!(user_id = %user_id, filename = %filename, media_type, bytes = data.len(), "media upload complete");
        let url = format!("/api/media/{}", filename);
        return Ok(Json(MediaUploadResponse {
            url,
            media_type: media_type.to_string(),
        }));
    }

    warn!(user_id = %user_id, "upload request had no 'file' field");
    Err(ApiError::BadRequest("no file field in request".into()))
}

pub async fn get_media(Path(filename): Path<String>) -> Response {
    if filename.contains('/') || filename.contains('\\') || filename.starts_with('.') {
        warn!(filename = %filename, "media request rejected: path traversal attempt");
        return ApiError::NotFound.into_response();
    }

    let uploads_dir = std::env::var("UPLOADS_DIR").unwrap_or_else(|_| "uploads".into());
    let path = std::path::Path::new(&uploads_dir).join(&filename);

    let data = match tokio::fs::read(&path).await {
        Ok(d) => d,
        Err(err) => {
            debug!(filename = %filename, path = %path.display(), error = %err, "media file not found");
            return ApiError::NotFound.into_response();
        }
    };

    let content_type = match path.extension().and_then(|e| e.to_str()) {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    };

    debug!(filename = %filename, content_type, bytes = data.len(), "media served");

    axum::http::Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, content_type)
        .header(axum::http::header::CONTENT_LENGTH, data.len())
        .body(axum::body::Body::from(data))
        .unwrap_or_else(|err| {
            error!(filename = %filename, error = %err, "media response build failed");
            ApiError::Internal("response build failed".into()).into_response()
        })
}

pub async fn create_invite_token(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<InviteTokenResponse>, ApiError> {
    let creator_id = authed_user(&headers, &state)?;
    let (code, expires_at) = state.create_invite_token(creator_id.clone(), now_ts());
    info!(user_id = %creator_id, code = %code, "invite token created");
    Ok(Json(InviteTokenResponse { code, expires_at }))
}

pub async fn add_friend_by_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RedeemInviteTokenRequest>,
) -> Result<StatusCode, ApiError> {
    let redeemer_id = authed_user(&headers, &state)?;
    let creator_id = state
        .consume_invite_token(&payload.code, now_ts())
        .ok_or(ApiError::NotFound)?;

    if redeemer_id == creator_id {
        return Err(ApiError::BadRequest("cannot add yourself".to_string()));
    }

    let sent_at = now_ts();
    let mut conn = state.pool.get().map_err(db_error)?;
    repository::add_friendship_pair(&mut conn, &redeemer_id, &creator_id, sent_at)
        .map_err(db_error)?;
    info!(redeemer = %redeemer_id, creator = %creator_id, "friendship pair recorded via invite token");

    let redeemer = repository::get_user(&mut conn, &redeemer_id).map_err(db_error)?;
    let creator = repository::get_user(&mut conn, &creator_id).map_err(db_error)?;
    let nonce_hex = "000000000000000000000000".to_string();

    // Notify redeemer: you now know the creator.
    let msg_to_redeemer_id = Uuid::new_v4().to_string();
    let payload_for_redeemer = hex::encode(
        serde_json::json!({"user_id": creator_id, "pubkey_hex": creator.pubkey_hex})
            .to_string()
            .as_bytes(),
    );
    repository::enqueue_message(
        &mut conn,
        &NewPendingMessage {
            id: &msg_to_redeemer_id,
            recipient_id: &redeemer_id,
            sender_id: &creator_id,
            payload_hex: &payload_for_redeemer,
            nonce_hex: &nonce_hex,
            msg_type: "friend_added",
            sent_at,
        },
    )
    .map_err(db_error)?;
    if state.send_to_online(
        &redeemer_id,
        ServerEnvelope::Message {
            id: msg_to_redeemer_id,
            sender_id: creator_id.clone(),
            payload_hex: payload_for_redeemer,
            nonce_hex: nonce_hex.clone(),
            msg_type: "friend_added".to_string(),
            sent_at,
        },
    ) {
        info!(redeemer = %redeemer_id, "friend_added delivered live to redeemer");
    }

    // Notify creator: you now know the redeemer.
    let msg_to_creator_id = Uuid::new_v4().to_string();
    let payload_for_creator = hex::encode(
        serde_json::json!({"user_id": redeemer_id, "pubkey_hex": redeemer.pubkey_hex})
            .to_string()
            .as_bytes(),
    );
    repository::enqueue_message(
        &mut conn,
        &NewPendingMessage {
            id: &msg_to_creator_id,
            recipient_id: &creator_id,
            sender_id: &redeemer_id,
            payload_hex: &payload_for_creator,
            nonce_hex: &nonce_hex,
            msg_type: "friend_added",
            sent_at,
        },
    )
    .map_err(db_error)?;
    if state.send_to_online(
        &creator_id,
        ServerEnvelope::Message {
            id: msg_to_creator_id,
            sender_id: redeemer_id.clone(),
            payload_hex: payload_for_creator,
            nonce_hex,
            msg_type: "friend_added".to_string(),
            sent_at,
        },
    ) {
        info!(creator = %creator_id, "friend_added delivered live to creator");
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
    info!(user_id = %user_id, "websocket upgrade accepted");

    Ok(ws
        .on_upgrade(move |socket| handle_socket(socket, state, user_id))
        .into_response())
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerEnvelope>();
    state.put_online(user_id.clone(), tx.clone());
    info!(user_id = %user_id, "websocket connected");

    if let Ok(mut conn) = state.pool.get() {
        if let Ok(messages) = repository::list_pending_messages(&mut conn, &user_id) {
            let count = messages.len();
            for message in messages {
                let _ = tx.send(ServerEnvelope::from(message));
            }
            debug!(user_id = %user_id, count, "websocket message drain queued");
        }

        if let Ok(posts) = repository::list_pending_posts(&mut conn, &user_id, now_ts()) {
            let count = posts.len();
            for post in posts {
                let _ = tx.send(ServerEnvelope::from(post));
            }
            debug!(user_id = %user_id, count, "websocket post drain queued");
        }

        if let Ok(messages) = repository::list_pending_group_messages(&mut conn, &user_id) {
            let count = messages.len();
            for message in messages {
                let _ = tx.send(ServerEnvelope::from(message));
            }
            debug!(user_id = %user_id, count, "websocket group message drain queued");
        }
    } else {
        error!(user_id = %user_id, "websocket initial drain could not acquire db connection");
    }

    loop {
        tokio::select! {
            Some(envelope) = rx.recv() => {
                // Server-to-client JSON envelope.
                match serde_json::to_string(&envelope) {
                    Ok(json) => {
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            warn!(user_id = %user_id, "websocket send failed");
                            break;
                        }
                    }
                    Err(err) => {
                        error!(user_id = %user_id, error = %err, "websocket envelope serialization failed");
                        break;
                    }
                }
            }
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(err)) => {
                        warn!(user_id = %user_id, error = %err, "websocket receive failed");
                        break;
                    }
                }
            }
        }
    }

    state.remove_online(&user_id);
    info!(user_id = %user_id, "websocket disconnected");
}
