use super::schema::{
    friendships, group_members, group_message_deliveries, group_messages, groups, pending_messages,
    pending_rescan_completions, post_categories, post_deliveries, posts, user_favourite_categories,
    users,
};
use diesel::{Identifiable, Insertable, Queryable, Selectable};

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = users)]
#[diesel(primary_key(user_id))]
pub struct User {
    pub user_id: String,
    pub pubkey_hex: String,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = users)]
pub struct NewUser<'a> {
    pub user_id: &'a str,
    pub pubkey_hex: &'a str,
    pub created_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = pending_messages)]
pub struct PendingMessage {
    pub id: String,
    pub recipient_id: String,
    pub sender_id: String,
    pub payload_hex: String,
    pub nonce_hex: String,
    pub msg_type: String,
    pub sent_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = pending_messages)]
pub struct NewPendingMessage<'a> {
    pub id: &'a str,
    pub recipient_id: &'a str,
    pub sender_id: &'a str,
    pub payload_hex: &'a str,
    pub nonce_hex: &'a str,
    pub msg_type: &'a str,
    pub sent_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = posts)]
#[diesel(belongs_to(User, foreign_key = author_id))]
pub struct Post {
    pub id: String,
    pub author_id: String,
    pub content: String,
    pub timestamp: i64,
    pub category: Option<String>,
    pub media_ref_name: Option<String>,
    pub image_url: Option<String>,
    pub attachment_url: Option<String>,
    pub attachment_type: Option<String>,
    pub attachments: Option<String>,
    pub rally_group_id: Option<String>,
    pub rally_max_members: Option<i32>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = posts)]
pub struct NewPost<'a> {
    pub id: &'a str,
    pub author_id: &'a str,
    pub content: &'a str,
    pub timestamp: i64,
    pub category: Option<&'a str>,
    pub media_ref_name: Option<&'a str>,
    pub image_url: Option<&'a str>,
    pub attachment_url: Option<&'a str>,
    pub attachment_type: Option<&'a str>,
    pub attachments: Option<&'a str>,
    pub rally_group_id: Option<&'a str>,
    pub rally_max_members: Option<i32>,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = groups)]
pub struct Group {
    pub id: String,
    pub creator_id: String,
    pub title: String,
    pub max_members: i32,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = groups)]
pub struct NewGroup<'a> {
    pub id: &'a str,
    pub creator_id: &'a str,
    pub title: &'a str,
    pub max_members: i32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = group_members)]
#[diesel(primary_key(group_id, user_id))]
#[diesel(belongs_to(Group, foreign_key = group_id))]
#[diesel(belongs_to(User, foreign_key = user_id))]
pub struct GroupMember {
    pub group_id: String,
    pub user_id: String,
    pub joined_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = group_members)]
pub struct NewGroupMember<'a> {
    pub group_id: &'a str,
    pub user_id: &'a str,
    pub joined_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = group_messages)]
pub struct GroupMessage {
    pub id: String,
    pub group_id: String,
    pub sender_id: String,
    pub payload_hex: String,
    pub sent_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = group_messages)]
pub struct NewGroupMessage<'a> {
    pub id: &'a str,
    pub group_id: &'a str,
    pub sender_id: &'a str,
    pub payload_hex: &'a str,
    pub sent_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = group_message_deliveries)]
#[diesel(primary_key(message_id, recipient_id))]
#[diesel(belongs_to(GroupMessage, foreign_key = message_id))]
#[diesel(belongs_to(User, foreign_key = recipient_id))]
pub struct GroupMessageDelivery {
    pub message_id: String,
    pub recipient_id: String,
    pub delivered_at: Option<i64>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = group_message_deliveries)]
pub struct NewGroupMessageDelivery<'a> {
    pub message_id: &'a str,
    pub recipient_id: &'a str,
    pub delivered_at: Option<i64>,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = post_deliveries)]
#[diesel(primary_key(post_id, recipient_id))]
#[diesel(belongs_to(Post, foreign_key = post_id))]
#[diesel(belongs_to(User, foreign_key = recipient_id))]
pub struct PostDelivery {
    pub post_id: String,
    pub recipient_id: String,
    pub delivered_at: Option<i64>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = post_deliveries)]
pub struct NewPostDelivery<'a> {
    pub post_id: &'a str,
    pub recipient_id: &'a str,
    pub delivered_at: Option<i64>,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = friendships)]
#[diesel(primary_key(user_a, user_b))]
pub struct Friendship {
    pub user_a: String,
    pub user_b: String,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = friendships)]
pub struct NewFriendship<'a> {
    pub user_a: &'a str,
    pub user_b: &'a str,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = pending_rescan_completions)]
pub struct NewPendingRescanCompletion<'a> {
    pub user_id: &'a str,
    pub category: &'a str,
    pub created_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = user_favourite_categories)]
#[diesel(primary_key(user_id, category))]
pub struct UserFavouriteCategory {
    pub user_id: String,
    pub category: String,
    pub created_at: i64,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = user_favourite_categories)]
pub struct NewUserFavouriteCategory<'a> {
    pub user_id: &'a str,
    pub category: &'a str,
    pub created_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, PartialEq, Eq)]
#[diesel(table_name = post_categories)]
#[diesel(primary_key(post_id, category))]
pub struct PostCategory {
    pub post_id: String,
    pub category: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = post_categories)]
pub struct NewPostCategory<'a> {
    pub post_id: &'a str,
    pub category: &'a str,
}
