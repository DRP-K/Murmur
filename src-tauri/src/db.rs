use once_cell::sync::OnceCell;
use rusqlite::{Connection, Result};
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn get() -> &'static Mutex<Connection> {
    DB.get().expect("DB not initialised")
}

pub fn init(path: &str) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    create_tables(&conn)?;
    DB.set(Mutex::new(conn)).ok();
    Ok(())
}

fn create_tables(conn: &Connection) -> Result<()> {
    // Migrate existing databases that predate the note column
    let _ = conn.execute("ALTER TABLE friends ADD COLUMN note TEXT", []);

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
            blocked_at    INTEGER,
            note          TEXT
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

