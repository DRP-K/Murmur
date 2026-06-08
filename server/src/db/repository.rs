use diesel::prelude::*;

use std::collections::HashMap;

use super::models::{
    Friendship, Group, GroupMember, GroupMessage, NewFriendship, NewGroup, NewGroupMember,
    NewGroupMessage, NewGroupMessageDelivery, NewPendingMessage, NewPendingRescanCompletion,
    NewPost, NewPostCategory, NewPostDelivery, NewUser, NewUserFavouriteCategory, PendingMessage,
    Post, PostDelivery, User,
};
use super::schema::{
    friendships, group_members, group_message_deliveries, group_messages, groups, pending_messages,
    pending_rescan_completions, post_categories, post_deliveries, posts, user_favourite_categories,
    users,
};

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

pub fn create_rally_post_with_deliveries(
    conn: &mut SqliteConnection,
    post: &NewPost<'_>,
    recipient_ids: &[&str],
    group: &NewGroup<'_>,
    creator_member: &NewGroupMember<'_>,
) -> QueryResult<usize> {
    conn.transaction(|conn| {
        diesel::insert_into(groups::table)
            .values(group)
            .execute(conn)?;
        diesel::insert_into(group_members::table)
            .values(creator_member)
            .execute(conn)?;
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
    _now: i64,
) -> QueryResult<Vec<Post>> {
    post_deliveries::table
        .inner_join(posts::table)
        .filter(post_deliveries::recipient_id.eq(recipient_id))
        .filter(post_deliveries::delivered_at.is_null())
        .select(Post::as_select())
        .order(posts::timestamp.asc())
        .load(conn)
}

/// Returns all posts ever delivered to a user (delivered or not), newest first.
/// Limited to 200 most recent to bound rescan cost.
pub fn list_all_posts_for_user(
    conn: &mut SqliteConnection,
    recipient_id: &str,
) -> QueryResult<Vec<Post>> {
    post_deliveries::table
        .inner_join(posts::table)
        .filter(post_deliveries::recipient_id.eq(recipient_id))
        .select(Post::as_select())
        .order(posts::timestamp.desc())
        .limit(200)
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

pub fn get_group(conn: &mut SqliteConnection, group_id: &str) -> QueryResult<Group> {
    groups::table
        .filter(groups::id.eq(group_id))
        .select(Group::as_select())
        .first(conn)
}

pub fn is_group_member(
    conn: &mut SqliteConnection,
    group_id: &str,
    user_id: &str,
) -> QueryResult<bool> {
    group_members::table
        .filter(group_members::group_id.eq(group_id))
        .filter(group_members::user_id.eq(user_id))
        .select(GroupMember::as_select())
        .first(conn)
        .optional()
        .map(|m| m.is_some())
}

pub fn list_group_members(
    conn: &mut SqliteConnection,
    group_id: &str,
) -> QueryResult<Vec<GroupMember>> {
    group_members::table
        .filter(group_members::group_id.eq(group_id))
        .order(group_members::joined_at.asc())
        .select(GroupMember::as_select())
        .load(conn)
}

pub fn join_group_if_space(
    conn: &mut SqliteConnection,
    group_id: &str,
    user_id: &str,
    joined_at: i64,
) -> QueryResult<(Group, Vec<GroupMember>, bool)> {
    conn.transaction(|conn| {
        let group = get_group(conn, group_id)?;
        if is_group_member(conn, group_id, user_id)? {
            let members = list_group_members(conn, group_id)?;
            return Ok((group, members, false));
        }

        let member_count: i64 = group_members::table
            .filter(group_members::group_id.eq(group_id))
            .count()
            .get_result(conn)?;
        if member_count >= i64::from(group.max_members) {
            return Err(diesel::result::Error::RollbackTransaction);
        }

        let member = NewGroupMember {
            group_id,
            user_id,
            joined_at,
        };
        diesel::insert_into(group_members::table)
            .values(&member)
            .execute(conn)?;
        let members = list_group_members(conn, group_id)?;
        Ok((group, members, true))
    })
}

pub fn list_groups_for_user(
    conn: &mut SqliteConnection,
    user_id: &str,
) -> QueryResult<Vec<(Group, Vec<GroupMember>)>> {
    let joined_groups = group_members::table
        .inner_join(groups::table)
        .filter(group_members::user_id.eq(user_id))
        .order(groups::created_at.desc())
        .select(Group::as_select())
        .load::<Group>(conn)?;

    let mut result = Vec::with_capacity(joined_groups.len());
    for group in joined_groups {
        let members = list_group_members(conn, &group.id)?;
        result.push((group, members));
    }
    Ok(result)
}

pub fn create_group_message_with_deliveries(
    conn: &mut SqliteConnection,
    message: &NewGroupMessage<'_>,
) -> QueryResult<Vec<String>> {
    conn.transaction(|conn| {
        if !is_group_member(conn, message.group_id, message.sender_id)? {
            return Err(diesel::result::Error::NotFound);
        }

        diesel::insert_into(group_messages::table)
            .values(message)
            .execute(conn)?;

        let recipients: Vec<String> = group_members::table
            .filter(group_members::group_id.eq(message.group_id))
            .filter(group_members::user_id.ne(message.sender_id))
            .select(group_members::user_id)
            .load(conn)?;

        if !recipients.is_empty() {
            let deliveries: Vec<NewGroupMessageDelivery<'_>> = recipients
                .iter()
                .map(|recipient_id| NewGroupMessageDelivery {
                    message_id: message.id,
                    recipient_id,
                    delivered_at: None,
                })
                .collect();
            diesel::insert_into(group_message_deliveries::table)
                .values(&deliveries)
                .execute(conn)?;
        }

        Ok(recipients)
    })
}

pub fn list_pending_group_messages(
    conn: &mut SqliteConnection,
    recipient_id: &str,
) -> QueryResult<Vec<GroupMessage>> {
    group_message_deliveries::table
        .inner_join(group_messages::table)
        .filter(group_message_deliveries::recipient_id.eq(recipient_id))
        .filter(group_message_deliveries::delivered_at.is_null())
        .order(group_messages::sent_at.asc())
        .select(GroupMessage::as_select())
        .load(conn)
}

pub fn list_pending_group_messages_for_group(
    conn: &mut SqliteConnection,
    group_id: &str,
    recipient_id: &str,
) -> QueryResult<Vec<GroupMessage>> {
    group_message_deliveries::table
        .inner_join(group_messages::table)
        .filter(group_message_deliveries::recipient_id.eq(recipient_id))
        .filter(group_message_deliveries::delivered_at.is_null())
        .filter(group_messages::group_id.eq(group_id))
        .order(group_messages::sent_at.asc())
        .select(GroupMessage::as_select())
        .load(conn)
}

pub fn mark_group_message_delivered(
    conn: &mut SqliteConnection,
    message_id: &str,
    recipient_id: &str,
    delivered_at: i64,
) -> QueryResult<usize> {
    diesel::update(
        group_message_deliveries::table
            .filter(group_message_deliveries::message_id.eq(message_id))
            .filter(group_message_deliveries::recipient_id.eq(recipient_id)),
    )
    .set(group_message_deliveries::delivered_at.eq(Some(delivered_at)))
    .execute(conn)
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
        list_pending_messages, mark_post_delivered, register_user,
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
            category: None,
            image_url: None,
            media_ref_name: None,
            attachment_url: None,
            attachment_type: None,
            attachments: None,
            rally_group_id: None,
            rally_max_members: None,
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

    // ── Favourite categories ──────────────────────────────────────────────────

    use super::{
        add_favourite_category, list_favourite_categories, list_favourite_categories_for_users,
        remove_favourite_category,
    };

    #[test]
    fn favourite_categories_add_list_remove() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();

        let cats = list_favourite_categories(&mut conn, "u1").unwrap();
        assert!(cats.is_empty());

        add_favourite_category(&mut conn, "u1", "CSGO", 200).unwrap();
        add_favourite_category(&mut conn, "u1", "games", 201).unwrap();

        let cats = list_favourite_categories(&mut conn, "u1").unwrap();
        assert_eq!(cats.len(), 2);
        assert!(cats.contains(&"CSGO".to_string()));
        assert!(cats.contains(&"games".to_string()));

        remove_favourite_category(&mut conn, "u1", "CSGO").unwrap();

        let cats = list_favourite_categories(&mut conn, "u1").unwrap();
        assert_eq!(cats, vec!["games"]);
    }

    #[test]
    fn add_favourite_category_is_idempotent() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();

        let n1 = add_favourite_category(&mut conn, "u1", "movies", 200).unwrap();
        let n2 = add_favourite_category(&mut conn, "u1", "movies", 201).unwrap();
        assert_eq!(n1, 1);
        assert_eq!(n2, 0); // conflict ignored

        let cats = list_favourite_categories(&mut conn, "u1").unwrap();
        assert_eq!(cats.len(), 1);
    }

    #[test]
    fn list_favourite_categories_for_users_batches_correctly() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();
        register_user(&mut conn, "u2", "pk2", 100).unwrap();

        add_favourite_category(&mut conn, "u1", "CSGO", 200).unwrap();
        add_favourite_category(&mut conn, "u1", "games", 201).unwrap();
        add_favourite_category(&mut conn, "u2", "music", 202).unwrap();

        let map = list_favourite_categories_for_users(&mut conn, &["u1", "u2"]).unwrap();
        let mut u1_cats = map["u1"].clone();
        u1_cats.sort();
        assert_eq!(u1_cats, vec!["CSGO", "games"]);
        assert_eq!(map["u2"], vec!["music"]);

        // User with no favourites should not appear in the map.
        let empty_map =
            list_favourite_categories_for_users(&mut conn, &["u1", "u2", "nonexistent"]).unwrap();
        assert!(!empty_map.contains_key("nonexistent"));
    }

    // ── Post categories ───────────────────────────────────────────────────────

    use super::{list_post_categories, list_post_categories_for_posts, set_post_categories};

    fn make_post(conn: &mut SqliteConnection, post_id: &str, author: &str) {
        let post = NewPost {
            id: post_id,
            author_id: author,
            content: "test content",
            timestamp: 1000,
            category: None,
            image_url: None,
            media_ref_name: None,
            attachment_url: None,
            attachment_type: None,
            attachments: None,
            rally_group_id: None,
            rally_max_members: None,
        };
        create_post_with_deliveries(conn, &post, &[]).unwrap();
    }

    #[test]
    fn set_and_list_post_categories() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();
        make_post(&mut conn, "p1", "u1");

        let cats = list_post_categories(&mut conn, "p1").unwrap();
        assert!(cats.is_empty());

        set_post_categories(&mut conn, "p1", &["CSGO".into(), "games".into()]).unwrap();

        let mut cats = list_post_categories(&mut conn, "p1").unwrap();
        cats.sort();
        assert_eq!(cats, vec!["CSGO", "games"]);
    }

    #[test]
    fn set_post_categories_is_idempotent() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();
        make_post(&mut conn, "p1", "u1");

        set_post_categories(&mut conn, "p1", &["games".into()]).unwrap();
        // Calling again with the same category should not error or duplicate.
        set_post_categories(&mut conn, "p1", &["games".into(), "CSGO".into()]).unwrap();

        let mut cats = list_post_categories(&mut conn, "p1").unwrap();
        cats.sort();
        assert_eq!(cats, vec!["CSGO", "games"]);
    }

    #[test]
    fn list_post_categories_for_posts_batches_correctly() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();
        make_post(&mut conn, "p1", "u1");
        make_post(&mut conn, "p2", "u1");

        set_post_categories(&mut conn, "p1", &["CSGO".into()]).unwrap();
        set_post_categories(&mut conn, "p2", &["music".into(), "jazz".into()]).unwrap();

        let map = list_post_categories_for_posts(&mut conn, &["p1", "p2", "p_missing"]).unwrap();
        assert_eq!(map["p1"], vec!["CSGO"]);
        let mut p2 = map["p2"].clone();
        p2.sort();
        assert_eq!(p2, vec!["jazz", "music"]);
        assert!(!map.contains_key("p_missing"));
    }

    // ── Rescan completion queue ───────────────────────────────────────────────

    use super::{drain_rescan_completions, queue_rescan_completion};

    #[test]
    fn rescan_completion_queue_and_drain() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();

        // Initially empty.
        let drained = drain_rescan_completions(&mut conn, "u1").unwrap();
        assert!(drained.is_empty());

        queue_rescan_completion(&mut conn, "u1", "CSGO", 200).unwrap();
        queue_rescan_completion(&mut conn, "u1", "games", 201).unwrap();

        let mut drained = drain_rescan_completions(&mut conn, "u1").unwrap();
        drained.sort();
        assert_eq!(drained, vec!["CSGO", "games"]);

        // After drain the queue should be empty.
        let after = drain_rescan_completions(&mut conn, "u1").unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn rescan_completion_queue_is_idempotent() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();

        queue_rescan_completion(&mut conn, "u1", "CSGO", 200).unwrap();
        queue_rescan_completion(&mut conn, "u1", "CSGO", 201).unwrap(); // duplicate

        let drained = drain_rescan_completions(&mut conn, "u1").unwrap();
        assert_eq!(drained.len(), 1);
    }

    #[test]
    fn rescan_completion_drain_is_user_scoped() {
        let mut conn = setup_conn();
        register_user(&mut conn, "u1", "pk1", 100).unwrap();
        register_user(&mut conn, "u2", "pk2", 100).unwrap();

        queue_rescan_completion(&mut conn, "u1", "CSGO", 200).unwrap();
        queue_rescan_completion(&mut conn, "u2", "music", 201).unwrap();

        // Draining u1 should not affect u2's queue.
        let u1 = drain_rescan_completions(&mut conn, "u1").unwrap();
        assert_eq!(u1, vec!["CSGO"]);

        let u2 = drain_rescan_completions(&mut conn, "u2").unwrap();
        assert_eq!(u2, vec!["music"]);
    }
}

// ── Favourite categories ──────────────────────────────────────────────────────

pub fn list_favourite_categories(
    conn: &mut SqliteConnection,
    uid: &str,
) -> QueryResult<Vec<String>> {
    user_favourite_categories::table
        .filter(user_favourite_categories::user_id.eq(uid))
        .select(user_favourite_categories::category)
        .load(conn)
}

pub fn add_favourite_category(
    conn: &mut SqliteConnection,
    uid: &str,
    category: &str,
    now: i64,
) -> QueryResult<usize> {
    diesel::insert_into(user_favourite_categories::table)
        .values(NewUserFavouriteCategory {
            user_id: uid,
            category,
            created_at: now,
        })
        .on_conflict((
            user_favourite_categories::user_id,
            user_favourite_categories::category,
        ))
        .do_nothing()
        .execute(conn)
}

pub fn remove_favourite_category(
    conn: &mut SqliteConnection,
    uid: &str,
    category: &str,
) -> QueryResult<usize> {
    diesel::delete(
        user_favourite_categories::table
            .filter(user_favourite_categories::user_id.eq(uid))
            .filter(user_favourite_categories::category.eq(category)),
    )
    .execute(conn)
}

/// Returns a map of user_id → their favourite category names, for multiple users at once.
pub fn list_favourite_categories_for_users(
    conn: &mut SqliteConnection,
    user_ids: &[&str],
) -> QueryResult<HashMap<String, Vec<String>>> {
    let rows: Vec<(String, String)> = user_favourite_categories::table
        .filter(user_favourite_categories::user_id.eq_any(user_ids))
        .select((
            user_favourite_categories::user_id,
            user_favourite_categories::category,
        ))
        .load(conn)?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for (uid, cat) in rows {
        map.entry(uid).or_default().push(cat);
    }
    Ok(map)
}

// ── Rescan completion queue ───────────────────────────────────────────────────

pub fn queue_rescan_completion(
    conn: &mut SqliteConnection,
    user_id: &str,
    category: &str,
    now: i64,
) -> QueryResult<usize> {
    diesel::insert_into(pending_rescan_completions::table)
        .values(NewPendingRescanCompletion {
            user_id,
            category,
            created_at: now,
        })
        .on_conflict((
            pending_rescan_completions::user_id,
            pending_rescan_completions::category,
        ))
        .do_nothing()
        .execute(conn)
}

/// Returns all pending rescan completion categories for the user and deletes them atomically.
pub fn drain_rescan_completions(
    conn: &mut SqliteConnection,
    user_id: &str,
) -> QueryResult<Vec<String>> {
    let categories: Vec<String> = pending_rescan_completions::table
        .filter(pending_rescan_completions::user_id.eq(user_id))
        .select(pending_rescan_completions::category)
        .load(conn)?;
    diesel::delete(
        pending_rescan_completions::table.filter(pending_rescan_completions::user_id.eq(user_id)),
    )
    .execute(conn)?;
    Ok(categories)
}

// ── Post categories ───────────────────────────────────────────────────────────

pub fn set_post_categories(
    conn: &mut SqliteConnection,
    post_id: &str,
    categories: &[String],
) -> QueryResult<()> {
    for cat in categories {
        diesel::insert_into(post_categories::table)
            .values(NewPostCategory {
                post_id,
                category: cat.as_str(),
            })
            .on_conflict((post_categories::post_id, post_categories::category))
            .do_nothing()
            .execute(conn)?;
    }
    Ok(())
}

pub fn list_post_categories(
    conn: &mut SqliteConnection,
    post_id: &str,
) -> QueryResult<Vec<String>> {
    post_categories::table
        .filter(post_categories::post_id.eq(post_id))
        .select(post_categories::category)
        .load(conn)
}

/// Fetch categories for multiple posts at once. Returns a map post_id → categories.
pub fn list_post_categories_for_posts(
    conn: &mut SqliteConnection,
    post_ids: &[&str],
) -> QueryResult<HashMap<String, Vec<String>>> {
    let rows: Vec<(String, String)> = post_categories::table
        .filter(post_categories::post_id.eq_any(post_ids))
        .select((post_categories::post_id, post_categories::category))
        .load(conn)?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for (pid, cat) in rows {
        map.entry(pid).or_default().push(cat);
    }
    Ok(map)
}
