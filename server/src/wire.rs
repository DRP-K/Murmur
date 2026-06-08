use serde::{Deserialize, Serialize};

use crate::db::models::{Group, GroupMember, GroupMessage, PendingMessage, Post};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaItem {
    pub url: String,
    pub media_type: String,
}

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
        category: Option<String>,
        media_ref_name: Option<String>,
        image_url: Option<String>,
        attachment_url: Option<String>,
        attachment_type: Option<String>,
        attachments: Option<Vec<MediaItem>>,
        rally_group_id: Option<String>,
        rally_max_members: Option<i32>,
        /// AI-classified categories matching recipients' favourites.
        #[serde(default)]
        categories: Vec<String>,
    },
    #[serde(rename = "group_message")]
    GroupMessage {
        id: String,
        group_id: String,
        sender_id: String,
        payload_hex: String,
        sent_at: i64,
    },
    #[serde(rename = "post_category_update")]
    PostCategoryUpdate { post_id: String, categories: Vec<String> },
    #[serde(rename = "rescan_complete")]
    RescanComplete { category: String },
    #[serde(rename = "group_update")]
    GroupUpdate { group: GroupInfo },
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
        Self::post_from_db(value, Vec::new())
    }
}

impl ServerEnvelope {
    pub fn post_from_db(value: Post, categories: Vec<String>) -> Self {
        Self::Post {
            id: value.id,
            author_id: value.author_id,
            content: value.content,
            timestamp: value.timestamp,
            category: value.category,
            media_ref_name: value.media_ref_name,
            image_url: value.image_url,
            attachment_url: value.attachment_url,
            attachment_type: value.attachment_type,
            attachments: value
                .attachments
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok()),
            rally_group_id: value.rally_group_id,
            rally_max_members: value.rally_max_members,
            categories,
        }
    }
}

impl From<GroupMessage> for ServerEnvelope {
    fn from(value: GroupMessage) -> Self {
        Self::GroupMessage {
            id: value.id,
            group_id: value.group_id,
            sender_id: value.sender_id,
            payload_hex: value.payload_hex,
            sent_at: value.sent_at,
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
    pub recipient_ids: Vec<String>,
    pub category: Option<String>,
    pub media_ref_name: Option<String>,
    pub image_url: Option<String>,
    pub attachment_url: Option<String>,
    pub attachment_type: Option<String>,
    pub attachments: Option<Vec<MediaItem>>,
    pub rally: Option<CreateRallyRequest>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRallyRequest {
    pub group_id: String,
    pub max_members: i32,
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

#[derive(Debug, Deserialize)]
pub struct SendGroupMessageRequest {
    pub id: String,
    pub payload_hex: String,
    pub sent_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct AckGroupMessageRequest {
    pub message_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GroupMemberInfo {
    pub user_id: String,
    pub joined_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct GroupInfo {
    pub id: String,
    pub creator_id: String,
    pub title: String,
    pub max_members: i32,
    pub created_at: i64,
    pub members: Vec<GroupMemberInfo>,
}

impl GroupInfo {
    pub fn from_group(group: Group, members: Vec<GroupMember>) -> Self {
        Self {
            id: group.id,
            creator_id: group.creator_id,
            title: group.title,
            max_members: group.max_members,
            created_at: group.created_at,
            members: members
                .into_iter()
                .map(|member| GroupMemberInfo {
                    user_id: member.user_id,
                    joined_at: member.joined_at,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupListResponse {
    pub groups: Vec<GroupInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupMessageListResponse {
    pub messages: Vec<ServerEnvelope>,
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

#[derive(Debug, Serialize)]
pub struct InviteTokenResponse {
    pub code: String,
    pub expires_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct RedeemInviteTokenRequest {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct FavouriteCategoriesResponse {
    pub categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddFavouriteCategoryRequest {
    pub category: String,
}
