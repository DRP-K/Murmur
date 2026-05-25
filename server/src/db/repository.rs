use diesel::prelude::*;

use super::models::{
    NewFriendship, NewPendingMessage, NewPost, NewPostDelivery, NewUser, PendingMessage,
    PostDelivery,
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

pub fn enqueue_message(conn: &mut SqliteConnection, msg: &NewPendingMessage<'_>) -> QueryResult<usize> {
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
    diesel::delete(pending_messages::table.filter(pending_messages::id.eq(message_id))).execute(conn)
}

pub fn create_post_with_deliveries(
    conn: &mut SqliteConnection,
    post: &NewPost<'_>,
    recipient_ids: &[&str],
) -> QueryResult<usize> {
    conn.transaction(|conn| {
        diesel::insert_into(posts::table).values(post).execute(conn)?;

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

        diesel::insert_into(post_deliveries::table)
            .values(&deliveries)
            .execute(conn)
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

#[cfg(test)]
mod tests {
    use diesel::dsl::count_star;
    use diesel::prelude::*;
    use diesel::sql_types::{BigInt, Text};

    use crate::db::models::NewPendingMessage;
    use crate::db::schema::{friendships, users};
    use crate::db::{establish_connection, run_migrations};

    use super::{
        ack_message, add_friendship_edge, create_post_with_deliveries, enqueue_message,
        get_post_delivery, list_pending_messages, mark_post_delivered, register_user,
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

        let inserted = register_user(&mut conn, "u1", "pk1", 100).expect("first insert should work");
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
        };

        let inserted_deliveries =
            create_post_with_deliveries(&mut conn, &post, &["u2", "u3"]).expect("fan-out should work");
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
}
