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
    conn.execute_batch("
        -- Registered users
        CREATE TABLE IF NOT EXISTS users (
            user_id    TEXT PRIMARY KEY,
            pubkey_hex TEXT NOT NULL,
            registered_at INTEGER NOT NULL
        );

        -- Encrypted messages queued for delivery
        CREATE TABLE IF NOT EXISTS pending_messages (
            id           TEXT PRIMARY KEY,
            sender_id    TEXT NOT NULL,
            recipient_id TEXT NOT NULL,
            payload_hex  TEXT NOT NULL,  -- encrypted blob
            nonce_hex    TEXT NOT NULL,
            msg_type     TEXT NOT NULL DEFAULT 'dm',  -- 'dm' | 'anon'
            sent_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pm_recipient
            ON pending_messages(recipient_id, sent_at);

        -- Feed posts with delivery tracking
        CREATE TABLE IF NOT EXISTS posts (
            id         TEXT PRIMARY KEY,
            author_id  TEXT NOT NULL,
            content    TEXT NOT NULL,
            timestamp  INTEGER NOT NULL,
            expires_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS post_deliveries (
            post_id      TEXT NOT NULL,
            recipient_id TEXT NOT NULL,
            delivered    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (post_id, recipient_id)
        );
        CREATE INDEX IF NOT EXISTS idx_pd_recipient
            ON post_deliveries(recipient_id, delivered);

        -- Mutual friendship graph (one row per directed edge)
        CREATE TABLE IF NOT EXISTS friendships (
            user_a TEXT NOT NULL,
            user_b TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_a, user_b)
        );
    ")?;
    DB.set(Mutex::new(conn)).ok();
    Ok(())
}

// ── Users ─────────────────────────────────────────────────────────────────────

pub fn upsert_user(user_id: &str, pubkey_hex: &str, now: i64) -> Result<()> {
    get().lock().unwrap().execute(
        "INSERT OR REPLACE INTO users (user_id, pubkey_hex, registered_at)
         VALUES (?1, ?2, ?3)",
        params![user_id, pubkey_hex, now],
    )?;
    Ok(())
}

pub fn get_pubkey(user_id: &str) -> Result<String> {
    get().lock().unwrap().query_row(
        "SELECT pubkey_hex FROM users WHERE user_id = ?1",
        params![user_id],
        |r| r.get(0),
    )
}

// ── Messages ──────────────────────────────────────────────────────────────────

pub fn queue_message(
    id: &str, sender_id: &str, recipient_id: &str,
    payload_hex: &str, nonce_hex: &str, msg_type: &str, now: i64,
) -> Result<()> {
    get().lock().unwrap().execute(
        "INSERT INTO pending_messages
         (id, sender_id, recipient_id, payload_hex, nonce_hex, msg_type, sent_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, sender_id, recipient_id, payload_hex, nonce_hex, msg_type, now],
    )?;
    Ok(())
}

#[derive(serde::Serialize, Clone)]
pub struct PendingMessage {
    pub id: String,
    pub sender_id: String,
    pub payload_hex: String,
    pub nonce_hex: String,
    pub msg_type: String,
    pub sent_at: i64,
}

pub fn pull_pending_messages(recipient_id: &str) -> Result<Vec<PendingMessage>> {
    let db = get().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, sender_id, payload_hex, nonce_hex, msg_type, sent_at
         FROM pending_messages WHERE recipient_id = ?1 ORDER BY sent_at ASC",
    )?;
    let rows = stmt.query_map(params![recipient_id], |r| {
        Ok(PendingMessage {
            id: r.get(0)?,
            sender_id: r.get(1)?,
            payload_hex: r.get(2)?,
            nonce_hex: r.get(3)?,
            msg_type: r.get(4)?,
            sent_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn ack_message(id: &str, recipient_id: &str) -> Result<()> {
    get().lock().unwrap().execute(
        "DELETE FROM pending_messages WHERE id = ?1 AND recipient_id = ?2",
        params![id, recipient_id],
    )?;
    Ok(())
}

// ── Posts ─────────────────────────────────────────────────────────────────────

pub fn publish_post(
    id: &str, author_id: &str, content: &str,
    timestamp: i64, expires_at: Option<i64>, recipients: &[String],
) -> Result<()> {
    let db = get().lock().unwrap();
    db.execute(
        "INSERT OR IGNORE INTO posts (id, author_id, content, timestamp, expires_at)
         VALUES (?1,?2,?3,?4,?5)",
        params![id, author_id, content, timestamp, expires_at],
    )?;
    for r in recipients {
        db.execute(
            "INSERT OR IGNORE INTO post_deliveries (post_id, recipient_id, delivered)
             VALUES (?1,?2,0)",
            params![id, r],
        )?;
    }
    Ok(())
}

#[derive(serde::Serialize, Clone)]
pub struct FeedPost {
    pub id: String,
    pub author_id: String,
    pub content: String,
    pub timestamp: i64,
    pub expires_at: Option<i64>,
}

pub fn pull_pending_posts(recipient_id: &str, now: i64) -> Result<Vec<FeedPost>> {
    let db = get().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT p.id, p.author_id, p.content, p.timestamp, p.expires_at
         FROM posts p
         JOIN post_deliveries d ON d.post_id = p.id
         WHERE d.recipient_id = ?1
           AND d.delivered = 0
           AND (p.expires_at IS NULL OR p.expires_at > ?2)
         ORDER BY p.timestamp ASC",
    )?;
    let rows = stmt.query_map(params![recipient_id, now], |r| {
        Ok(FeedPost {
            id: r.get(0)?,
            author_id: r.get(1)?,
            content: r.get(2)?,
            timestamp: r.get(3)?,
            expires_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

// ── Friendships ───────────────────────────────────────────────────────────────

pub fn add_friendship(user_a: &str, user_b: &str, now: i64) -> Result<()> {
    let db = get().lock().unwrap();
    db.execute(
        "INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?1,?2,?3)",
        params![user_a, user_b, now],
    )?;
    Ok(())
}

pub fn get_friends_of(user_id: &str) -> Result<Vec<String>> {
    let db = get().lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT user_b FROM friendships WHERE user_a = ?1",
    )?;
    let rows = stmt.query_map(params![user_id], |r| r.get(0))?;
    rows.collect()
}

pub fn ack_post(post_id: &str, recipient_id: &str) -> Result<()> {
    get().lock().unwrap().execute(
        "UPDATE post_deliveries SET delivered = 1
         WHERE post_id = ?1 AND recipient_id = ?2",
        params![post_id, recipient_id],
    )?;
    Ok(())
}
