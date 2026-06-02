use diesel::prelude::*;

use super::models::{
    Friendship, NewFriendship, NewPendingMessage, NewPost, NewPostDelivery, NewUser,
    PendingMessage, Post, PostDelivery, User,
};
use super::schema::{friendships, pending_messages, post_deliveries, posts, users};

pub fn register_user(
    conn: &mut SqliteConnection,
    user_id: &str,
    pubkey_hex: &str,
    created_at: i64,
) -> QueryResult<usize> {
    let new_user = NewUser {
        user_id,
        pubkey_hex,
        created_at,
    };

    diesel::insert_into(users::table)
        .values(&new_user)
        .on_conflict(users::user_id)
        .do_nothing()
        .execute(conn)
}

pub fn get_user(conn: &mut SqliteConnection, user_id: &str) -> QueryResult<User> {
    users::table
        .filter(users::user_id.eq(user_id))
        .select(User::as_select())
        .first(conn)
}

pub fn enqueue_message(
    conn: &mut SqliteConnection,
    msg: &NewPendingMessage<'_>,
) -> QueryResult<usize> {
    diesel::insert_into(pending_messages::table)
        .values(msg)
        .execute(conn)
}

pub fn list_pending_messages(
    conn: &mut SqliteConnection,
    recipient: &str,
) -> QueryResult<Vec<PendingMessage>> {
    pending_messages::table
        .filter(pending_messages::recipient_id.eq(recipient))
        .order(pending_messages::sent_at.asc())
        .select(PendingMessage::as_select())
        .load(conn)
}

pub fn ack_message(conn: &mut SqliteConnection, message_id: &str) -> QueryResult<usize> {
    diesel::delete(pending_messages::table.filter(pending_messages::id.eq(message_id)))
        .execute(conn)
}

pub fn ack_message_for_recipient(
    conn: &mut SqliteConnection,
    message_id: &str,
    recipient: &str,
) -> QueryResult<usize> {
    diesel::delete(
        pending_messages::table
            .filter(pending_messages::id.eq(message_id))
            .filter(pending_messages::recipient_id.eq(recipient)),
    )
    .execute(conn)
}

pub fn create_post_with_deliveries(
    conn: &mut SqliteConnection,
    post: &NewPost<'_>,
    recipient_ids: &[&str],
) -> QueryResult<usize> {
    conn.transaction(|conn| {
        diesel::insert_into(posts::table)
            .values(post)
            .execute(conn)?;

        if recipient_ids.is_empty() {
            return Ok(0);
        }

        let deliveries: Vec<NewPostDelivery<'_>> = recipient_ids
            .iter()
            .map(|recipient_id| NewPostDelivery {
                post_id: post.id,
                recipient_id: *recipient_id,
                delivered_at: None,
            })
            .collect();

        diesel::insert_or_ignore_into(post_deliveries::table)
            .values(&deliveries)
            .execute(conn)
    })
}

pub fn ensure_rich_post_with_delivery(
    conn: &mut SqliteConnection,
    post: &NewPost<'_>,
    recipient_id: &str,
) -> QueryResult<usize> {
    conn.transaction(|conn| {
        let existing = posts::table
            .filter(posts::id.eq(post.id))
            .select(Post::as_select())
            .first(conn)
            .optional()?;
        let should_redeliver = existing.as_ref().is_none_or(|existing| {
            existing.content != post.content
                || existing.category.as_deref() != post.category
                || existing.media_ref_name.as_deref() != post.media_ref_name
                || existing.image_url.as_deref() != post.image_url
        });

        match existing {
            Some(_) => {
                diesel::update(posts::table.filter(posts::id.eq(post.id)))
                    .set((
                        posts::author_id.eq(post.author_id),
                        posts::content.eq(post.content),
                        posts::timestamp.eq(post.timestamp),
                        posts::expires_at.eq(post.expires_at),
                        posts::category.eq(post.category),
                        posts::media_ref_name.eq(post.media_ref_name),
                        posts::image_url.eq(post.image_url),
                    ))
                    .execute(conn)?;
            }
            None => {
                diesel::insert_into(posts::table)
                    .values(post)
                    .execute(conn)?;
            }
        }

        let delivery = NewPostDelivery {
            post_id: post.id,
            recipient_id,
            delivered_at: None,
        };

        if should_redeliver {
            diesel::insert_into(post_deliveries::table)
                .values(&delivery)
                .on_conflict((post_deliveries::post_id, post_deliveries::recipient_id))
                .do_update()
                .set(post_deliveries::delivered_at.eq(None::<i64>))
                .execute(conn)
        } else {
            diesel::insert_into(post_deliveries::table)
                .values(&delivery)
                .on_conflict((post_deliveries::post_id, post_deliveries::recipient_id))
                .do_nothing()
                .execute(conn)
        }
    })
}

pub fn mark_post_delivered(
    conn: &mut SqliteConnection,
    post_id: &str,
    recipient_id: &str,
    delivered_at: i64,
) -> QueryResult<usize> {
    diesel::update(
        post_deliveries::table
            .filter(post_deliveries::post_id.eq(post_id))
            .filter(post_deliveries::recipient_id.eq(recipient_id)),
    )
    .set(post_deliveries::delivered_at.eq(Some(delivered_at)))
    .execute(conn)
}

pub fn get_post_delivery(
    conn: &mut SqliteConnection,
    post_id: &str,
    recipient_id: &str,
) -> QueryResult<PostDelivery> {
    post_deliveries::table
        .filter(post_deliveries::post_id.eq(post_id))
        .filter(post_deliveries::recipient_id.eq(recipient_id))
        .select(PostDelivery::as_select())
        .first(conn)
}

pub fn list_pending_posts(
    conn: &mut SqliteConnection,
    recipient_id: &str,
    now: i64,
) -> QueryResult<Vec<Post>> {
    post_deliveries::table
        .inner_join(posts::table)
        .filter(post_deliveries::recipient_id.eq(recipient_id))
        .filter(post_deliveries::delivered_at.is_null())
        .filter(posts::expires_at.is_null().or(posts::expires_at.gt(now)))
        .filter(
            posts::scheduled_at
                .is_null()
                .or(posts::scheduled_at.le(now)),
        )
        .select(Post::as_select())
        .order(posts::timestamp.asc())
        .load(conn)
}

pub fn add_friendship_edge(
    conn: &mut SqliteConnection,
    user_a: &str,
    user_b: &str,
    created_at: i64,
) -> QueryResult<usize> {
    let edge = NewFriendship {
        user_a,
        user_b,
        created_at,
    };

    diesel::insert_into(friendships::table)
        .values(&edge)
        .execute(conn)
}

pub fn add_friendship_pair(
    conn: &mut SqliteConnection,
    user_a: &str,
    user_b: &str,
    created_at: i64,
) -> QueryResult<usize> {
    conn.transaction(|conn| {
        let first = NewFriendship {
            user_a,
            user_b,
            created_at,
        };
        let second = NewFriendship {
            user_a: user_b,
            user_b: user_a,
            created_at,
        };

        let inserted_first = diesel::insert_into(friendships::table)
            .values(&first)
            .on_conflict((friendships::user_a, friendships::user_b))
            .do_nothing()
            .execute(conn)?;
        let inserted_second = diesel::insert_into(friendships::table)
            .values(&second)
            .on_conflict((friendships::user_a, friendships::user_b))
            .do_nothing()
            .execute(conn)?;

        Ok(inserted_first + inserted_second)
    })
}

pub fn list_friends_for_user(
    conn: &mut SqliteConnection,
    user_id: &str,
) -> QueryResult<Vec<(String, String, i64)>> {
    // Returns (friend_user_id, friend_pubkey_hex, friendship_created_at)
    friendships::table
        .inner_join(users::table.on(friendships::user_b.eq(users::user_id)))
        .filter(friendships::user_a.eq(user_id))
        .select((
            friendships::user_b,
            users::pubkey_hex,
            friendships::created_at,
        ))
        .load(conn)
}

pub fn get_friendship(
    conn: &mut SqliteConnection,
    user_a: &str,
    user_b: &str,
) -> QueryResult<Friendship> {
    friendships::table
        .filter(friendships::user_a.eq(user_a))
        .filter(friendships::user_b.eq(user_b))
        .select(Friendship::as_select())
        .first(conn)
}

pub fn list_due_scheduled_deliveries(
    conn: &mut SqliteConnection,
    now: i64,
) -> QueryResult<Vec<(Post, String)>> {
    post_deliveries::table
        .inner_join(posts::table)
        .filter(post_deliveries::delivered_at.is_null())
        .filter(posts::scheduled_at.is_not_null())
        .filter(posts::scheduled_at.le(now))
        .select((Post::as_select(), post_deliveries::recipient_id))
        .load(conn)
}

#[cfg(test)]
mod tests {
    use diesel::dsl::count_star;
    use diesel::prelude::*;
    use diesel::sql_types::{BigInt, Text};

    use crate::db::models::NewPendingMessage;
    use crate::db::schema::{friendships, users};
    use crate::db::{establish_connection, run_migrations};

    use super::{
        ack_message, ack_message_for_recipient, add_friendship_edge, add_friendship_pair,
        create_post_with_deliveries, enqueue_message, get_friendship, get_post_delivery,
        list_due_scheduled_deliveries, list_pending_messages, list_pending_posts,
        mark_post_delivered, register_user,
    };
    use crate::db::models::NewPost;

    fn setup_conn() -> SqliteConnection {
        let mut conn = establish_connection(":memory:").expect("in-memory sqlite should open");
        run_migrations(&mut conn).expect("migrations should run");
        conn
    }

    #[derive(QueryableByName)]
    struct TableRow {
        #[diesel(sql_type = Text)]
        name: String,
    }

    #[test]
    fn runs_migrations_and_creates_expected_tables() {
        let mut conn = setup_conn();

        let rows = diesel::sql_query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','pending_messages','posts','post_deliveries','friendships')",
        )
        .load::<TableRow>(&mut conn)
        .expect("table query should succeed");

        let table_names: Vec<String> = rows.iter().map(|r| r.name.clone()).collect();
        assert_eq!(rows.len(), 5);
        assert!(table_names.iter().any(|n| n == "users"));
        assert!(table_names.iter().any(|n| n == "pending_messages"));
        assert!(table_names.iter().any(|n| n == "posts"));
        assert!(table_names.iter().any(|n| n == "post_deliveries"));
        assert!(table_names.iter().any(|n| n == "friendships"));
    }

    #[test]
    fn register_user_is_idempotent() {
        let mut conn = setup_conn();

        let inserted =
            register_user(&mut conn, "u1", "pk1", 100).expect("first insert should work");
        let inserted_again =
            register_user(&mut conn, "u1", "pk1", 200).expect("second insert should work");

        let total: i64 = users::table
            .select(count_star())
            .first(&mut conn)
            .expect("count should work");

        assert_eq!(inserted, 1);
        assert_eq!(inserted_again, 0);
        assert_eq!(total, 1);
    }

    #[test]
    fn enqueue_list_and_ack_message() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("sender should exist");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient should exist");

        let msg = NewPendingMessage {
            id: "m1",
            recipient_id: "u2",
            sender_id: "u1",
            payload_hex: "6869",
            nonce_hex: "0000",
            msg_type: "dm",
            sent_at: 123,
        };

        enqueue_message(&mut conn, &msg).expect("enqueue should work");

        let pending = list_pending_messages(&mut conn, "u2").expect("list should work");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, "m1");

        let removed = ack_message(&mut conn, "m1").expect("ack should work");
        assert_eq!(removed, 1);

        let pending_after = list_pending_messages(&mut conn, "u2").expect("list should still work");
        assert!(pending_after.is_empty());
    }

    #[test]
    fn scoped_ack_only_deletes_recipient_message() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("sender should exist");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient should exist");
        register_user(&mut conn, "u3", "pk3", 100).expect("other recipient should exist");

        let msg = NewPendingMessage {
            id: "m1",
            recipient_id: "u2",
            sender_id: "u1",
            payload_hex: "6869",
            nonce_hex: "0000",
            msg_type: "dm",
            sent_at: 123,
        };
        enqueue_message(&mut conn, &msg).expect("enqueue should work");

        let wrong_recipient =
            ack_message_for_recipient(&mut conn, "m1", "u3").expect("scoped ack should run");
        assert_eq!(wrong_recipient, 0);
        assert_eq!(
            list_pending_messages(&mut conn, "u2")
                .expect("list should work")
                .len(),
            1
        );

        let right_recipient =
            ack_message_for_recipient(&mut conn, "m1", "u2").expect("scoped ack should run");
        assert_eq!(right_recipient, 1);
    }

    #[test]
    fn create_post_and_mark_delivery() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("author should exist");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient should exist");
        register_user(&mut conn, "u3", "pk3", 100).expect("recipient should exist");

        let post = NewPost {
            id: "p1",
            author_id: "u1",
            content: "hello",
            timestamp: 1000,
            expires_at: None,
            category: None,
            image_url: None,
            media_ref_name: None,
            attachment_url: None,
            attachment_type: None,
            attachments: None,
            scheduled_at: None,
        };

        let inserted_deliveries = create_post_with_deliveries(&mut conn, &post, &["u2", "u3"])
            .expect("fan-out should work");
        assert_eq!(inserted_deliveries, 2);

        let before = get_post_delivery(&mut conn, "p1", "u2").expect("delivery should exist");
        assert_eq!(before.delivered_at, None);

        let updated =
            mark_post_delivered(&mut conn, "p1", "u2", 2000).expect("mark delivered should work");
        assert_eq!(updated, 1);

        let after = get_post_delivery(&mut conn, "p1", "u2").expect("delivery should exist");
        assert_eq!(after.delivered_at, Some(2000));
    }

    #[test]
    fn pending_posts_filter_expired_posts() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("author should exist");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient should exist");

        let fresh = NewPost {
            id: "fresh",
            author_id: "u1",
            content: "fresh",
            timestamp: 1000,
            expires_at: Some(2_000),
            category: None,
            image_url: None,
            media_ref_name: None,
            attachment_url: None,
            attachment_type: None,
            attachments: None,
            scheduled_at: None,
        };
        let expired = NewPost {
            id: "expired",
            author_id: "u1",
            content: "expired",
            timestamp: 999,
            expires_at: Some(1_000),
            category: None,
            image_url: None,
            media_ref_name: None,
            attachment_url: None,
            attachment_type: None,
            attachments: None,
            scheduled_at: None,
        };

        create_post_with_deliveries(&mut conn, &fresh, &["u2"]).expect("fresh fan-out should work");
        create_post_with_deliveries(&mut conn, &expired, &["u2"])
            .expect("expired fan-out should work");

        let posts = list_pending_posts(&mut conn, "u2", 1_500).expect("pending posts should list");
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "fresh");
    }

    #[test]
    fn directed_friendship_edges_enforce_composite_key_uniqueness() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("user should exist");
        register_user(&mut conn, "u2", "pk2", 100).expect("user should exist");

        add_friendship_edge(&mut conn, "u1", "u2", 111).expect("u1->u2 should insert");
        add_friendship_edge(&mut conn, "u2", "u1", 112).expect("u2->u1 should insert");

        let duplicate = add_friendship_edge(&mut conn, "u1", "u2", 113);
        assert!(duplicate.is_err());

        #[derive(QueryableByName)]
        struct CountRow {
            #[diesel(sql_type = BigInt)]
            count: i64,
        }

        let row = diesel::sql_query("SELECT COUNT(*) as count FROM friendships")
            .get_result::<CountRow>(&mut conn)
            .expect("count query should succeed");

        assert_eq!(row.count, 2);

        let via_dsl: i64 = friendships::table
            .select(count_star())
            .first(&mut conn)
            .expect("dsl count should succeed");
        assert_eq!(via_dsl, 2);
    }

    #[test]
    fn friendship_requires_existing_users_via_foreign_keys() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("user should exist");

        let missing_target = add_friendship_edge(&mut conn, "u1", "missing", 111);
        assert!(missing_target.is_err());
    }

    #[test]
    fn friendship_pair_inserts_both_directions_idempotently() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("user should exist");
        register_user(&mut conn, "u2", "pk2", 100).expect("user should exist");

        let inserted = add_friendship_pair(&mut conn, "u1", "u2", 111).expect("pair should insert");
        assert_eq!(inserted, 2);
        get_friendship(&mut conn, "u1", "u2").expect("forward edge should exist");
        get_friendship(&mut conn, "u2", "u1").expect("reverse edge should exist");

        let inserted_again = add_friendship_pair(&mut conn, "u1", "u2", 112)
            .expect("pair insert should be idempotent");
        assert_eq!(inserted_again, 0);
    }

    fn scheduled_post(id: &'static str, scheduled_at: Option<i64>) -> NewPost<'static> {
        NewPost {
            id,
            author_id: "u1",
            content: "scheduled",
            timestamp: 1000,
            expires_at: None,
            category: None,
            image_url: None,
            media_ref_name: None,
            attachment_url: None,
            attachment_type: None,
            attachments: None,
            scheduled_at,
        }
    }

    #[test]
    fn scheduled_post_hidden_before_due_time() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("author");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient");

        create_post_with_deliveries(&mut conn, &scheduled_post("p1", Some(2_000)), &["u2"])
            .expect("fanout");

        let posts = list_pending_posts(&mut conn, "u2", 1_500).expect("list");
        assert!(
            posts.is_empty(),
            "post should not appear before scheduled_at"
        );
    }

    #[test]
    fn scheduled_post_visible_after_due_time() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("author");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient");

        create_post_with_deliveries(&mut conn, &scheduled_post("p1", Some(1_000)), &["u2"])
            .expect("fanout");

        let posts = list_pending_posts(&mut conn, "u2", 1_500).expect("list");
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "p1");
    }

    #[test]
    fn list_due_scheduled_deliveries_returns_only_due_posts() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).expect("author");
        register_user(&mut conn, "u2", "pk2", 100).expect("recipient");

        create_post_with_deliveries(&mut conn, &scheduled_post("due", Some(1_000)), &["u2"])
            .expect("fanout due");
        create_post_with_deliveries(&mut conn, &scheduled_post("future", Some(3_000)), &["u2"])
            .expect("fanout future");
        create_post_with_deliveries(&mut conn, &scheduled_post("immediate", None), &["u2"])
            .expect("fanout immediate");

        let deliveries = list_due_scheduled_deliveries(&mut conn, 2_000).expect("list");
        assert_eq!(deliveries.len(), 1);
        assert_eq!(deliveries[0].0.id, "due");
        assert_eq!(deliveries[0].1, "u2");
    }
}
