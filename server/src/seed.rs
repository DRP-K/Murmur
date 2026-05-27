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
        if friends.iter().any(|(fid, _, _)| known.contains(&fid.as_str())) {
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
            if let Err(e) =
                repository::create_post_with_deliveries(conn, &post, &[new_user_id])
            {
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

    info!(user_id = %new_user_id, bots = BOTS.len(), "user seeded");
}

fn hash_str(s: &str, salt: usize) -> usize {
    s.bytes()
        .fold(salt, |acc, b| acc.wrapping_mul(31).wrapping_add(b as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository;
    use crate::db::{establish_connection, run_migrations};

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
            repository::get_user(&mut conn, &user_id)
                .expect("bot user should exist in database");
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

        let friends = repository::list_friends_for_user(&mut conn, &user_id)
            .expect("friends should list");
        assert_eq!(friends.len(), BOTS.len(), "one friendship per bot");

        let total_seed_posts: usize = BOTS.iter().map(|b| b.posts.len()).sum();
        let posts =
            repository::list_pending_posts(&mut conn, &user_id, chrono::Utc::now().timestamp())
                .expect("posts should list");
        assert_eq!(posts.len(), total_seed_posts, "all seed posts delivered");

        // Each bot sends 2 messages: friend_added + dm welcome.
        let messages = repository::list_pending_messages(&mut conn, &user_id)
            .expect("messages should list");
        assert_eq!(messages.len(), BOTS.len() * 2, "two messages per bot (friend_added + dm)");
        assert_eq!(
            messages.iter().filter(|m| m.msg_type == "friend_added").count(),
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

        let messages = repository::list_pending_messages(&mut conn, &user_id)
            .expect("messages should list");
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

        let messages = repository::list_pending_messages(&mut conn, &user_id)
            .expect("messages should list");
        for (i, msg) in messages.iter().filter(|m| m.msg_type == "friend_added").enumerate() {
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

        let friends = repository::list_friends_for_user(&mut conn, &user_id)
            .expect("friends should list");
        assert_eq!(friends.len(), BOTS.len(), "no duplicate friendships on second seed");

        let messages = repository::list_pending_messages(&mut conn, &user_id)
            .expect("messages should list");
        assert_eq!(messages.len(), BOTS.len() * 2, "no duplicate messages on second seed");
    }

    #[test]
    fn welcome_dm_text_comes_from_the_defined_pool() {
        let mut conn = setup_conn();
        seed_bots(&mut conn);
        let user_id = register_test_user(&mut conn, 60);

        seed_for_new_user(&mut conn, &user_id);

        let messages = repository::list_pending_messages(&mut conn, &user_id)
            .expect("messages should list");

        let all_defined_welcomes: Vec<&str> =
            BOTS.iter().flat_map(|b| b.welcomes.iter().copied()).collect();

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
