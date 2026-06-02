use serde::{Deserialize, Serialize};

use crate::db::models::{PendingMessage, Post};

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub user_id: String,
    pub pubkey_hex: String,
}

#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    pub user_id: String,
    pub timestamp: i64,
    pub signature_hex: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub id: String,
    pub recipient_id: String,
    pub payload_hex: String,
    pub nonce_hex: String,
    pub msg_type: String,
    pub sent_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ServerEnvelope {
    #[serde(rename = "message")]
    Message {
        id: String,
        sender_id: String,
        payload_hex: String,
        nonce_hex: String,
        msg_type: String,
        sent_at: i64,
    },
    #[serde(rename = "post")]
    Post {
        id: String,
        author_id: String,
        content: String,
        timestamp: i64,
        expires_at: Option<i64>,
        category: Option<String>,
        media_ref_name: Option<String>,
        image_url: Option<String>,
        attachment_url: Option<String>,
        attachment_type: Option<String>,
    },
    #[serde(rename = "delivered_ack")]
    DeliveredAck { id: String },
}

impl From<PendingMessage> for ServerEnvelope {
    fn from(value: PendingMessage) -> Self {
        Self::Message {
            id: value.id,
            sender_id: value.sender_id,
            payload_hex: value.payload_hex,
            nonce_hex: value.nonce_hex,
            msg_type: value.msg_type,
            sent_at: value.sent_at,
        }
    }
}

impl From<Post> for ServerEnvelope {
    fn from(value: Post) -> Self {
        Self::Post {
            id: value.id,
            author_id: value.author_id,
            content: value.content,
            timestamp: value.timestamp,
            expires_at: value.expires_at,
            category: value.category,
            media_ref_name: value.media_ref_name,
            image_url: value.image_url,
            attachment_url: value.attachment_url,
            attachment_type: value.attachment_type,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageListResponse {
    pub messages: Vec<ServerEnvelope>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePostRequest {
    pub id: String,
    pub content: String,
    pub timestamp: i64,
    pub expires_at: Option<i64>,
    pub recipient_ids: Vec<String>,
    pub category: Option<String>,
    pub media_ref_name: Option<String>,
    pub image_url: Option<String>,
    pub attachment_url: Option<String>,
    pub attachment_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostAssistRequest {
    pub prefix: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct PostAssistResponse {
    pub completed_content: String,
    pub category: Option<String>,
    pub media_ref_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MediaUploadResponse {
    pub url: String,
    pub media_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PostListResponse {
    pub posts: Vec<ServerEnvelope>,
}

#[derive(Debug, Deserialize)]
pub struct AckPostRequest {
    pub post_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FriendInfo {
    pub user_id: String,
    pub pubkey_hex: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FriendListResponse {
    pub friends: Vec<FriendInfo>,
}

#[derive(Debug, Deserialize)]
pub struct AddFriendRequest {
    pub friend_id: String,
}
