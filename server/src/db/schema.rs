// @generated automatically by Diesel CLI.

diesel::table! {
    friendships (user_a, user_b) {
        user_a -> Text,
        user_b -> Text,
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

diesel::allow_tables_to_appear_in_same_query!(
    friendships,
    pending_messages,
    post_deliveries,
    posts,
    users,
);
