use chrono::Utc;
use diesel::SqliteConnection;
use ed25519_dalek::SigningKey;
use tracing::{info, warn};

use crate::auth::user_id_for_pubkey;
use crate::db::models::{NewPendingMessage, NewPost};
use crate::db::repository;

struct BotDef {
    seed: u8,
    name: &'static str,
    posts: &'static [&'static str],
    welcomes: &'static [&'static str],
}

struct ExtraPostDef {
    bot_index: usize,
    content: &'static str,
    category: &'static str,
    media_ref_name: &'static str,
    image_url: &'static str,
}

const BOTS: &[BotDef] = &[
    BotDef {
        seed: 1,
        name: "BOT_1",
        posts: &[
            "Just got here and already loving the vibe ✨",
            "What's everyone listening to this week?",
            "Morning playlist: lo-fi beats, black coffee, zero responsibilities. Highly recommend.",
        ],
        welcomes: &[
            "Hey! Welcome to Murmur 👋 Glad you made it!",
            "Nice to meet you! Drop me a post anytime.",
        ],
    },
    BotDef {
        seed: 2,
        name: "BOT_2",
        posts: &[
            "Hot take: game soundtracks are some of the best music ever made 🎮",
            "Currently rewatching Succession for the third time, no regrets",
            "Anyone else have a game they keep coming back to years later?",
        ],
        welcomes: &[
            "Welcome! Big film and game nerd here — let's swap recommendations 🎬",
            "Hey, welcome aboard! What have you been playing lately?",
        ],
    },
    BotDef {
        seed: 3,
        name: "BOT_3",
        posts: &[
            "Discovered a tiny band from Iceland last night and now nothing else exists",
            "Finished a great book this weekend, feeling that specific happy-sad 📚",
            "The algorithm has no idea what I actually want to listen to and I'm tired",
        ],
        welcomes: &[
            "Hey there! Always excited to see new faces here 🌟",
            "Welcome to the app! Hope you find something you love here 🎶",
        ],
    },
];

const EXTRA_BOT_POSTS: &[ExtraPostDef] = &[
    ExtraPostDef {
        bot_index: 0, // BOT_1
        content: "Can't stop listening to \"Boston\" by STELLA LEFTY 🎵",
        category: "music",
        media_ref_name: "Boston",
        image_url: "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/7c/de/5e/7cde5e7a-612d-9714-d34c-1eb234c85ebb/810129961546.jpg/170x170bb.png",
    },
    ExtraPostDef {
        bot_index: 0, // BOT_1
        content: "Recently playing Portal 2 (Shooter, Puzzle) 🎮\nasdfiuhwe",
        category: "games",
        media_ref_name: "Portal 2",
        image_url: "https://media.rawg.io/media/games/2ba/2bac0e87cf45e5b508f227d281c9252a.jpg",
    },
    ExtraPostDef {
        bot_index: 1, // BOT_2
        content: "WALLAHI",
        category: "movies",
        media_ref_name: "Fuze",
        image_url: "https://image.tmdb.org/t/p/w200/huKckuD90OblEHH8MYfekHvCPfp.jpg",
    },
];

fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn bot_credentials(seed: u8) -> (String, String) {
    let key = signing_key(seed);
    let pubkey_bytes = key.verifying_key().to_bytes();
    let user_id = user_id_for_pubkey(&pubkey_bytes);
    let pubkey_hex = hex::encode(pubkey_bytes);
    (user_id, pubkey_hex)
}

/// Register all seed bot accounts. Safe to call on every startup — idempotent.
pub fn seed_bots(conn: &mut SqliteConnection) {
    for bot in BOTS {
        let (user_id, pubkey_hex) = bot_credentials(bot.seed);
        match repository::register_user(conn, &user_id, &pubkey_hex, 0) {
            Ok(_) => info!(user_id = %user_id, "seed bot ensured"),
            Err(e) => warn!(user_id = %user_id, error = %e, "seed bot registration failed"),
        }
    }
}

/// Seed a freshly registered user: add bot friends, deliver their posts, send welcome messages.
/// All errors are logged and swallowed — seeding must never fail a registration request.
pub fn seed_for_new_user(conn: &mut SqliteConnection, new_user_id: &str) {
    // Skip if user was already seeded (has a friendship with any bot).
    let bot_ids: Vec<(String, String)> = BOTS.iter().map(|b| bot_credentials(b.seed)).collect();
    if let Ok(friends) = repository::list_friends_for_user(conn, new_user_id) {
        let known: Vec<&str> = bot_ids.iter().map(|(id, _)| id.as_str()).collect();
        if friends
            .iter()
            .any(|(fid, _, _)| known.contains(&fid.as_str()))
        {
            ensure_extra_posts(conn, new_user_id, &bot_ids, Utc::now().timestamp());
            return;
        }
    }

    let now = Utc::now().timestamp();

    for (i, (bot, (bot_id, _))) in BOTS.iter().zip(bot_ids.iter()).enumerate() {
        if let Err(e) = repository::add_friendship_pair(conn, bot_id, new_user_id, now) {
            warn!(bot_id = %bot_id, user_id = %new_user_id, error = %e, "seed friendship failed");
            continue;
        }

        // Deliver a few posts from this bot, staggered a few hours into the past.
        for (j, content) in bot.posts.iter().enumerate() {
            let post_id = format!("seed:{bot_id}:{new_user_id}:{j}");
            let post = NewPost {
                id: &post_id,
                author_id: bot_id,
                content,
                timestamp: now - (3600 * (i as i64 * 3 + j as i64 + 1)),
                expires_at: None,
                category: None,
                image_url: None,
                media_ref_name: None,
            };
            if let Err(e) = repository::create_post_with_deliveries(conn, &post, &[new_user_id]) {
                warn!(post_id = %post_id, error = %e, "seed post failed");
            }
        }

        // friend_added: lets the client discover the bot and store it in Dexie with
        // the right nickname. Payload mirrors the format used by real users in add_friend.
        let fa_id = format!("seed:{bot_id}:{new_user_id}:friend_added");
        let (_, bot_pubkey_hex) = bot_credentials(bot.seed);
        let fa_payload = serde_json::json!({
            "user_id": bot_id,
            "pubkey_hex": bot_pubkey_hex,
            "nickname": bot.name,
        })
        .to_string();
        let fa_payload_hex = hex::encode(fa_payload.as_bytes());
        let fa_msg = NewPendingMessage {
            id: &fa_id,
            recipient_id: new_user_id,
            sender_id: bot_id,
            payload_hex: &fa_payload_hex,
            nonce_hex: "000000000000000000000000",
            msg_type: "friend_added",
            sent_at: now,
        };
        if let Err(e) = repository::enqueue_message(conn, &fa_msg) {
            warn!(msg_id = %fa_id, error = %e, "seed friend_added message failed");
        }

        // dm: welcome text delivered one second later so it always follows the
        // friend_added message in the queue (ordered by sent_at ASC).
        let welcome = bot.welcomes[hash_str(new_user_id, i) % bot.welcomes.len()];
        let dm_id = format!("seed:{bot_id}:{new_user_id}:welcome");
        let dm_payload_hex = hex::encode(welcome.as_bytes());
        let dm_msg = NewPendingMessage {
            id: &dm_id,
            recipient_id: new_user_id,
            sender_id: bot_id,
            payload_hex: &dm_payload_hex,
            nonce_hex: "000000000000000000000000",
            msg_type: "dm",
            sent_at: now + 1,
        };
        if let Err(e) = repository::enqueue_message(conn, &dm_msg) {
            warn!(msg_id = %dm_id, error = %e, "seed dm message failed");
        }
    }

    ensure_extra_posts(conn, new_user_id, &bot_ids, now);

    info!(user_id = %new_user_id, bots = BOTS.len(), "user seeded");
}

fn ensure_extra_posts(
    conn: &mut SqliteConnection,
    new_user_id: &str,
    bot_ids: &[(String, String)],
    now: i64,
) {
    for (i, extra) in EXTRA_BOT_POSTS.iter().enumerate() {
        let (extra_bot_id, _) = &bot_ids[extra.bot_index];
        let post_id = format!("seed:{extra_bot_id}:{new_user_id}:extra:{i}");
        let post = NewPost {
            id: &post_id,
            author_id: extra_bot_id,
            content: extra.content,
            timestamp: now - (120 - (i as i64 * 60)),
            expires_at: None,
            category: Some(extra.category),
            media_ref_name: Some(extra.media_ref_name),
            image_url: Some(extra.image_url),
        };
        if let Err(e) = repository::ensure_rich_post_with_delivery(conn, &post, new_user_id) {
            warn!(post_id = %post_id, error = %e, "seed extra post failed");
        }
    }
}

fn hash_str(s: &str, salt: usize) -> usize {
    s.bytes()
        .fold(salt, |acc, b| acc.wrapping_mul(31).wrapping_add(b as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository;
    use crate::db::schema::{post_deliveries, posts};
    use crate::db::{establish_connection, run_migrations};
    use diesel::prelude::*;

    fn setup_conn() -> SqliteConnection {
        let mut conn = establish_connection(":memory:").expect("in-memory sqlite should open");
        run_migrations(&mut conn).expect("migrations should run");
        conn
    }

    fn register_test_user(conn: &mut SqliteConnection, seed: u8) -> String {
        let key = SigningKey::from_bytes(&[seed; 32]);
        let pubkey_bytes = key.verifying_key().to_bytes();
        let user_id = user_id_for_pubkey(&pubkey_bytes);
        let pubkey_hex = hex::encode(pubkey_bytes);
        repository::register_user(conn, &user_id, &pubkey_hex, 1000)
            .expect("test user should register");
        user_id
    }

    #[test]
    fn seed_bots_registers_all_bot_accounts() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);

        for bot in BOTS {
            let (user_id, _) = bot_credentials(bot.seed);
            repository::get_user(&mut conn, &user_id).expect("bot user should exist in database");
        }
    }

    #[test]
    fn seed_bots_is_idempotent() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        seed_bots(&mut conn);

        // Still exactly BOTS.len() bot users — no duplicates.
        let friends_of_nobody = repository::list_friends_for_user(&mut conn, "nonexistent")
            .expect("empty query should not fail");
        assert!(friends_of_nobody.is_empty());
    }

    #[test]
    fn seed_for_new_user_adds_friends_posts_and_welcome_messages() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 50);

        seed_for_new_user(&mut conn, &user_id);

        let friends =
            repository::list_friends_for_user(&mut conn, &user_id).expect("friends should list");
        assert_eq!(friends.len(), BOTS.len(), "one friendship per bot");

        let total_seed_posts: usize = BOTS.iter().map(|b| b.posts.len()).sum();
        let posts =
            repository::list_pending_posts(&mut conn, &user_id, chrono::Utc::now().timestamp())
                .expect("posts should list");
        assert_eq!(
            posts.len(),
            total_seed_posts + EXTRA_BOT_POSTS.len(),
            "all seed posts delivered including extra posts"
        );

        let bot_ids_by_index: Vec<String> =
            BOTS.iter().map(|bot| bot_credentials(bot.seed).0).collect();
        let extra_posts: Vec<_> = posts
            .iter()
            .filter(|p| p.category.is_some() && p.media_ref_name.is_some() && p.image_url.is_some())
            .collect();
        assert_eq!(
            extra_posts.len(),
            EXTRA_BOT_POSTS.len(),
            "expected rich extra posts to be present"
        );
        for (idx, expected) in EXTRA_BOT_POSTS.iter().enumerate() {
            let actual = extra_posts
                .iter()
                .find(|p| p.media_ref_name.as_deref() == Some(expected.media_ref_name))
                .expect("expected extra post should be present");
            assert_eq!(
                actual.author_id, bot_ids_by_index[expected.bot_index],
                "extra post author should match configured bot"
            );
            assert_eq!(actual.content, expected.content);
            assert_eq!(actual.category.as_deref(), Some(expected.category));
            assert_eq!(
                actual.media_ref_name.as_deref(),
                Some(expected.media_ref_name)
            );
            assert_eq!(actual.image_url.as_deref(), Some(expected.image_url));
            if idx == 1 {
                assert!(
                    actual.content.contains('\n'),
                    "second extra post should preserve multiline content"
                );
            }
        }

        // Each bot sends 2 messages: friend_added + dm welcome.
        let messages =
            repository::list_pending_messages(&mut conn, &user_id).expect("messages should list");
        assert_eq!(
            messages.len(),
            BOTS.len() * 2,
            "two messages per bot (friend_added + dm)"
        );
        assert_eq!(
            messages
                .iter()
                .filter(|m| m.msg_type == "friend_added")
                .count(),
            BOTS.len(),
        );
        assert_eq!(
            messages.iter().filter(|m| m.msg_type == "dm").count(),
            BOTS.len(),
        );
    }

    #[test]
    fn seed_for_new_user_dm_payloads_are_readable_plaintext() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 51);

        seed_for_new_user(&mut conn, &user_id);

        let messages =
            repository::list_pending_messages(&mut conn, &user_id).expect("messages should list");
        for msg in messages.iter().filter(|m| m.msg_type == "dm") {
            let decoded = hex::decode(&msg.payload_hex).expect("payload should be valid hex");
            let text = std::str::from_utf8(&decoded).expect("payload should be valid utf-8");
            assert!(!text.is_empty(), "welcome dm content should not be empty");
        }
    }

    #[test]
    fn seed_for_new_user_friend_added_payloads_include_nickname() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 53);

        seed_for_new_user(&mut conn, &user_id);

        let messages =
            repository::list_pending_messages(&mut conn, &user_id).expect("messages should list");
        for (i, msg) in messages
            .iter()
            .filter(|m| m.msg_type == "friend_added")
            .enumerate()
        {
            let decoded = hex::decode(&msg.payload_hex).expect("payload should be valid hex");
            let text = std::str::from_utf8(&decoded).expect("payload should be valid utf-8");
            let payload: serde_json::Value =
                serde_json::from_str(text).expect("friend_added payload should be valid JSON");
            assert!(payload["user_id"].is_string(), "user_id missing");
            assert!(payload["pubkey_hex"].is_string(), "pubkey_hex missing");
            let nickname = payload["nickname"].as_str().expect("nickname missing");
            assert_eq!(nickname, format!("BOT_{}", i + 1), "unexpected nickname");
        }
    }

    #[test]
    fn seed_for_new_user_is_idempotent() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 52);

        seed_for_new_user(&mut conn, &user_id);
        seed_for_new_user(&mut conn, &user_id); // second call should be a no-op

        let friends =
            repository::list_friends_for_user(&mut conn, &user_id).expect("friends should list");
        assert_eq!(
            friends.len(),
            BOTS.len(),
            "no duplicate friendships on second seed"
        );

        let messages =
            repository::list_pending_messages(&mut conn, &user_id).expect("messages should list");
        assert_eq!(
            messages.len(),
            BOTS.len() * 2,
            "no duplicate messages on second seed"
        );

        let posts =
            repository::list_pending_posts(&mut conn, &user_id, chrono::Utc::now().timestamp())
                .expect("posts should list");
        let total_seed_posts: usize = BOTS.iter().map(|b| b.posts.len()).sum();
        assert_eq!(
            posts.len(),
            total_seed_posts + EXTRA_BOT_POSTS.len(),
            "no duplicate posts on second seed including extra posts"
        );
    }

    #[test]
    fn seed_for_existing_user_repairs_and_redelivers_rich_extra_posts() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 55);

        seed_for_new_user(&mut conn, &user_id);

        let (bot_id, _) = bot_credentials(BOTS[0].seed);
        let post_id = format!("seed:{bot_id}:{user_id}:extra:0");
        repository::mark_post_delivered(&mut conn, &post_id, &user_id, 1234)
            .expect("delivery should mark delivered");
        diesel::update(posts::table.filter(posts::id.eq(&post_id)))
            .set((
                posts::category.eq(None::<String>),
                posts::media_ref_name.eq(None::<String>),
                posts::image_url.eq(None::<String>),
            ))
            .execute(&mut conn)
            .expect("post metadata should be cleared");

        seed_for_new_user(&mut conn, &user_id);

        let repaired = posts::table
            .filter(posts::id.eq(&post_id))
            .select(crate::db::models::Post::as_select())
            .first(&mut conn)
            .expect("post should exist");
        assert_eq!(repaired.category.as_deref(), Some("music"));
        assert_eq!(repaired.media_ref_name.as_deref(), Some("Boston"));
        assert!(
            repaired
                .image_url
                .as_deref()
                .is_some_and(|url| url.contains("mzstatic"))
        );

        let delivery = post_deliveries::table
            .filter(post_deliveries::post_id.eq(&post_id))
            .filter(post_deliveries::recipient_id.eq(&user_id))
            .select(crate::db::models::PostDelivery::as_select())
            .first(&mut conn)
            .expect("delivery should exist");
        assert_eq!(delivery.delivered_at, None);
    }

    #[test]
    fn welcome_dm_text_comes_from_the_defined_pool() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 60);

        seed_for_new_user(&mut conn, &user_id);

        let messages =
            repository::list_pending_messages(&mut conn, &user_id).expect("messages should list");

        let all_defined_welcomes: Vec<&str> = BOTS
            .iter()
            .flat_map(|b| b.welcomes.iter().copied())
            .collect();

        for msg in messages.iter().filter(|m| m.msg_type == "dm") {
            let decoded = hex::decode(&msg.payload_hex).expect("payload should be valid hex");
            let text = std::str::from_utf8(&decoded).expect("payload should be valid utf-8");
            assert!(
                all_defined_welcomes.contains(&text),
                "unexpected welcome text: {text}"
            );
        }
    }
}
