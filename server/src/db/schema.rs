// @generated automatically by Diesel CLI.

diesel::table! {
    friendships (user_a, user_b) {
        user_a -> Text,
        user_b -> Text,
        created_at -> BigInt,
    }
}

diesel::table! {
    group_message_deliveries (message_id, recipient_id) {
        message_id -> Text,
        recipient_id -> Text,
        delivered_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    group_members (group_id, user_id) {
        group_id -> Text,
        user_id -> Text,
        joined_at -> BigInt,
    }
}

diesel::table! {
    group_messages (id) {
        id -> Text,
        group_id -> Text,
        sender_id -> Text,
        payload_hex -> Text,
        sent_at -> BigInt,
    }
}

diesel::table! {
    groups (id) {
        id -> Text,
        creator_id -> Text,
        title -> Text,
        max_members -> Integer,
        created_at -> BigInt,
    }
}

diesel::table! {
    pending_messages (id) {
        id -> Text,
        recipient_id -> Text,
        sender_id -> Text,
        payload_hex -> Text,
        nonce_hex -> Text,
        msg_type -> Text,
        sent_at -> BigInt,
    }
}

diesel::table! {
    post_deliveries (post_id, recipient_id) {
        post_id -> Text,
        recipient_id -> Text,
        delivered_at -> Nullable<BigInt>,
    }
}

diesel::table! {
    posts (id) {
        id -> Text,
        author_id -> Text,
        content -> Text,
        timestamp -> BigInt,
        expires_at -> Nullable<BigInt>,
        category -> Nullable<Text>,
        media_ref_name -> Nullable<Text>,
        image_url -> Nullable<Text>,
        attachment_url -> Nullable<Text>,
        attachment_type -> Nullable<Text>,
        attachments -> Nullable<Text>,
        scheduled_at -> Nullable<BigInt>,
        rally_group_id -> Nullable<Text>,
        rally_max_members -> Nullable<Integer>,
    }
}

diesel::table! {
    users (user_id) {
        user_id -> Text,
        pubkey_hex -> Text,
        created_at -> BigInt,
    }
}

diesel::joinable!(post_deliveries -> posts (post_id));
diesel::joinable!(post_deliveries -> users (recipient_id));
diesel::joinable!(posts -> users (author_id));
diesel::joinable!(group_message_deliveries -> group_messages (message_id));
diesel::joinable!(group_message_deliveries -> users (recipient_id));
diesel::joinable!(group_members -> groups (group_id));
diesel::joinable!(group_members -> users (user_id));
diesel::joinable!(group_messages -> groups (group_id));

diesel::allow_tables_to_appear_in_same_query!(
    friendships,
    group_message_deliveries,
    group_members,
    group_messages,
    groups,
    pending_messages,
    post_deliveries,
    posts,
    users,
);
