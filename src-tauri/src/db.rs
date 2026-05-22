use once_cell::sync::OnceCell;
use rusqlite::{params, Connection, Result};
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn get() -> &'static Mutex<Connection> {
    DB.get().expect("DB not initialised")
}

pub fn init(path: &str) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    create_tables(&conn)?;
    seed_demo_friends(&conn)?;
    seed_demo_posts(&conn)?;
    seed_demo_messages(&conn)?;
    DB.set(Mutex::new(conn)).ok();
    Ok(())
}

fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS identity (
            user_id      TEXT PRIMARY KEY,
            pubkey_hex   TEXT NOT NULL,
            privkey_hex  TEXT NOT NULL,
            display_name TEXT,
            created_at   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS friends (
            user_id       TEXT PRIMARY KEY,
            pubkey_hex    TEXT NOT NULL,
            dh_shared_hex TEXT NOT NULL,
            nickname      TEXT,
            relay_address TEXT,
            added_at      INTEGER NOT NULL,
            blocked_at    INTEGER
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sender_id       TEXT NOT NULL,
            plaintext       TEXT NOT NULL,
            timestamp       INTEGER NOT NULL,
            status          TEXT NOT NULL DEFAULT 'sent'
        );
        CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, timestamp);

        CREATE TABLE IF NOT EXISTS posts (
            id         TEXT PRIMARY KEY,
            author_id  TEXT NOT NULL,
            content    TEXT NOT NULL,
            timestamp  INTEGER NOT NULL,
            expires_at INTEGER,
            is_own     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_posts_ts ON posts(timestamp DESC);

        CREATE TABLE IF NOT EXISTS reactions (
            post_id       TEXT NOT NULL,
            emoji         TEXT NOT NULL,
            count         INTEGER NOT NULL DEFAULT 0,
            reacted_by_me INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (post_id, emoji)
        );

        CREATE TABLE IF NOT EXISTS anon_threads (
            id                TEXT PRIMARY KEY,
            post_id           TEXT NOT NULL,
            post_snippet      TEXT NOT NULL,
            ephemeral_pub_hex TEXT NOT NULL,
            ephemeral_prv_hex TEXT,
            is_initiator      INTEGER NOT NULL,
            status            TEXT NOT NULL DEFAULT 'open',
            created_at        INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS anon_messages (
            id          TEXT PRIMARY KEY,
            thread_id   TEXT NOT NULL,
            plaintext   TEXT NOT NULL,
            from_author INTEGER NOT NULL,
            timestamp   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_anon_msg ON anon_messages(thread_id, timestamp);
    ")?;
    Ok(())
}

fn seed_demo_friends(conn: &Connection) -> Result<()> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM friends", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // (user_id, pubkey_hex placeholder, nickname, added_at offset seconds)
    let friends: &[(&str, &str, i64)] = &[
        ("demo_friend_000000000000000000000", "Alice",   now - 86400 * 30),
        ("demo_friend_111111111111111111111", "Bob",     now - 86400 * 14),
        ("demo_friend_222222222222222222222", "Carol",   now - 86400 * 7),
        ("demo_friend_333333333333333333333", "Dan",     now - 86400 * 2),
    ];

    for (uid, nickname, added_at) in friends {
        // pubkey and shared secret are placeholders — no real crypto needed for demo friends
        let fake_pubkey = format!("{:0>64}", uid.replace("demo_friend_", ""));
        let fake_shared = format!("{:0>64}", "0");
        conn.execute(
            "INSERT OR IGNORE INTO friends (user_id, pubkey_hex, dh_shared_hex, nickname, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![uid, fake_pubkey, fake_shared, nickname, added_at],
        )?;
    }
    Ok(())
}

fn seed_demo_posts(conn: &Connection) -> Result<()> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM posts", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // (post_id, author_id, timestamp offset, content, hearts, waves)
    let posts: &[(&str, &str, i64, &str, u32, u32)] = &[
        (
            "p1",
            "demo_friend_000000000000000000000",
            now - 7200,
            "Just saw the most beautiful sunset from the park today. Sometimes you just need to stop and look up.",
            12, 3,
        ),
        (
            "p2",
            "demo_friend_111111111111111111111",
            now - 18000,
            "Anyone else feel like everything is moving too fast lately? Like, when did it become May already?",
            8, 5,
        ),
        (
            "p3",
            "demo_friend_222222222222222222222",
            now - 86400,
            "Got the job!! Finally. Three months of interviews and it's actually happening.",
            31, 7,
        ),
        (
            "p4",
            "demo_friend_333333333333333333333",
            now - 86400 * 2,
            "Made my grandmother's soup recipe for the first time without her guidance. Tasted exactly right. Cried a little.",
            24, 11,
        ),
        (
            "p5",
            "demo_friend_000000000000000000000",
            now - 86400 * 3,
            "Unpopular opinion: sitting in silence is one of the most underrated things you can do for yourself.",
            19, 6,
        ),
        (
            "p6",
            "demo_friend_111111111111111111111",
            now - 3600,
            "The library near my place has a free seed library. You just take what you need and leave some if you have extras. Humanity isn't lost.",
            42, 9,
        ),
    ];

    for (id, author, ts, content, hearts, waves) in posts {
        conn.execute(
            "INSERT INTO posts (id, author_id, content, timestamp, is_own) VALUES (?1, ?2, ?3, ?4, 0)",
            params![id, author, content, ts],
        )?;
        conn.execute(
            "INSERT INTO reactions (post_id, emoji, count, reacted_by_me) VALUES (?1, '❤', ?2, 0)",
            params![id, hearts],
        )?;
        conn.execute(
            "INSERT INTO reactions (post_id, emoji, count, reacted_by_me) VALUES (?1, '~', ?2, 0)",
            params![id, waves],
        )?;
    }
    Ok(())
}

fn seed_demo_messages(conn: &Connection) -> Result<()> {
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    // We need our own user_id to build conversation_id.
    // If identity hasn't been created yet it's fine — messages will be seeded on next open.
    let my_id: rusqlite::Result<String> =
        conn.query_row("SELECT user_id FROM identity LIMIT 1", [], |r| r.get(0));
    let my_id = match my_id {
        Ok(id) => id,
        Err(_) => return Ok(()), // identity not yet created, skip
    };

    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let alice = "demo_friend_000000000000000000000";
    let bob   = "demo_friend_111111111111111111111";

    // Conversation IDs follow the same logic as convo_id() in commands.rs:
    // sort([my_id, friend_id]).join("-")
    let alice_cid = {
        let mut parts = [my_id.as_str(), alice];
        parts.sort();
        parts.join("-")
    };
    let bob_cid = {
        let mut parts = [my_id.as_str(), bob];
        parts.sort();
        parts.join("-")
    };

    // (id, convo_id, sender_id, text, ts_offset)
    let msgs: &[(&str, &str, &str, &str, i64)] = &[
        // Alice conversation (yesterday + today)
        ("m01", &alice_cid, alice,    "hey are you free this weekend?",                         now - 86400 - 3600 * 5),
        ("m02", &alice_cid, &my_id,   "yeah! what do you have in mind?",                        now - 86400 - 3600 * 4),
        ("m03", &alice_cid, alice,    "thinking coffee at the usual spot, maybe 11am?",          now - 86400 - 3600 * 4 + 120),
        ("m04", &alice_cid, &my_id,   "perfect, see you then!",                                 now - 86400 - 3600 * 4 + 240),
        ("m05", &alice_cid, alice,    "also did you see that post about the seed library??",     now - 3600 * 3),
        ("m06", &alice_cid, &my_id,   "omg yes!! humanity is not lost after all",               now - 3600 * 3 + 90),
        ("m07", &alice_cid, alice,    "haha exactly",                                           now - 3600 * 3 + 150),
        ("m08", &alice_cid, &my_id,   "we should go check it out sometime",                     now - 3600 * 2),
        ("m09", &alice_cid, alice,    "100%",                                                   now - 3600 * 2 + 60),

        // Bob conversation
        ("m10", &bob_cid,   &my_id,   "hey, did you get a chance to look at that thing I sent?", now - 7200),
        ("m11", &bob_cid,   bob,      "just did — looks good to me",                             now - 7200 + 300),
        ("m12", &bob_cid,   bob,      "a few small notes but nothing major",                     now - 7200 + 310),
        ("m13", &bob_cid,   &my_id,   "great, I'll make those changes tonight",                  now - 7200 + 600),
        ("m14", &bob_cid,   bob,      "ok sounds good",                                          now - 3600),
    ];

    for (id, cid, sender, text, ts) in msgs {
        conn.execute(
            "INSERT INTO messages (id, conversation_id, sender_id, plaintext, timestamp, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'delivered')",
            params![id, cid, sender, text, ts],
        )?;
    }
    Ok(())
}
