use crate::{crypto, db, relay};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ─── Types returned to frontend ───────────────────────────────────────────────

#[derive(Serialize)]
pub struct Identity {
    pub user_id: String,
    pub display_name: Option<String>,
    pub pubkey_hex: String,
}

#[derive(Serialize)]
pub struct Friend {
    pub user_id: String,
    pub nickname: Option<String>,
    pub added_at: i64,
    pub blocked_at: Option<i64>,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub plaintext: String,
    pub timestamp: i64,
    pub status: String,
}

#[derive(Serialize, Clone)]
pub struct Post {
    pub id: String,
    pub author_id: String,
    pub content: String,
    pub timestamp: i64,
    pub expires_at: Option<i64>,
    pub is_own: bool,
    pub reactions: std::collections::HashMap<String, u32>,
    pub my_reactions: Vec<String>,
}

#[derive(Serialize)]
pub struct AnonThread {
    pub id: String,
    pub post_id: String,
    pub post_snippet: String,
    pub is_initiator: bool,
    pub status: String,
    pub created_at: i64,
    pub last_message: Option<String>,
    pub last_message_at: Option<i64>,
}

#[derive(Serialize)]
pub struct AnonMessage {
    pub id: String,
    pub thread_id: String,
    pub plaintext: String,
    pub from_author: bool,
    pub timestamp: i64,
}

#[derive(Serialize)]
pub struct Conversation {
    pub friend_id: String,
    pub nickname: Option<String>,
    pub last_message: Option<String>,
    pub last_message_at: Option<i64>,
    pub unread_count: u32,
}

// ─── QR payload ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct QrPayload {
    user_id: String,
    pubkey_hex: String,
    relay_address: Option<String>,
    nickname: Option<String>,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_or_create_identity() -> Result<Identity, String> {
    let db = db::get().lock().unwrap();
    let result: rusqlite::Result<Identity> = db.query_row(
        "SELECT user_id, pubkey_hex, display_name FROM identity LIMIT 1",
        [],
        |row| {
            Ok(Identity {
                user_id: row.get(0)?,
                pubkey_hex: row.get(1)?,
                display_name: row.get(2)?,
            })
        },
    );
    match result {
        Ok(id) => Ok(id),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let kp = crypto::generate_keypair();
            db.execute(
                "INSERT INTO identity (user_id, pubkey_hex, privkey_hex, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![kp.user_id, kp.pubkey_hex, kp.privkey_hex, now()],
            )
            .map_err(|e| e.to_string())?;
            drop(db);
            // Bootstrap relay on first launch
            let (uid, pub_hex, priv_hex) = (kp.user_id.clone(), kp.pubkey_hex.clone(), kp.privkey_hex.clone());
            tauri::async_runtime::spawn(async move {
                relay::bootstrap(uid, pub_hex, priv_hex).await;
            });
            Ok(Identity {
                user_id: kp.user_id,
                display_name: None,
                pubkey_hex: kp.pubkey_hex,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_display_name(name: String) -> Result<(), String> {
    let db = db::get().lock().unwrap();
    db.execute("UPDATE identity SET display_name = ?1", params![name])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_qr_payload() -> Result<String, String> {
    let db = db::get().lock().unwrap();
    let (user_id, pubkey_hex, display_name): (String, String, Option<String>) = db
        .query_row(
            "SELECT user_id, pubkey_hex, display_name FROM identity LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let payload = QrPayload {
        user_id,
        pubkey_hex,
        relay_address: None,
        nickname: display_name,
    };
    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

// ─── Friends ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_friends() -> Result<Vec<Friend>, String> {
    let db = db::get().lock().unwrap();
    let mut stmt = db
        .prepare("SELECT user_id, nickname, added_at, blocked_at, note FROM friends WHERE blocked_at IS NULL ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Friend {
                user_id: row.get(0)?,
                nickname: row.get(1)?,
                added_at: row.get(2)?,
                blocked_at: row.get(3)?,
                note: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_friend_from_qr(payload: String, note: Option<String>) -> Result<Friend, String> {
    let qr: QrPayload = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    let db = db::get().lock().unwrap();

    // Get our private key for ECDH
    let our_privkey: String = db
        .query_row("SELECT privkey_hex FROM identity LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let our_id: String = db
        .query_row("SELECT user_id FROM identity LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if qr.user_id == our_id {
        return Err("Cannot add yourself".into());
    }

    let shared = crypto::derive_shared_secret(&our_privkey, &qr.pubkey_hex);
    let trimmed_note = note.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);

    db.execute(
        "INSERT OR REPLACE INTO friends (user_id, pubkey_hex, dh_shared_hex, nickname, relay_address, added_at, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            qr.user_id, qr.pubkey_hex, shared,
            qr.nickname.as_deref().or(Some(&qr.user_id[..8])),
            qr.relay_address, now(), trimmed_note.clone()
        ],
    )
    .map_err(|e| e.to_string())?;
    drop(db);

    // Tell the server about the friendship so it can route messages
    let fid = qr.user_id.clone();
    let fpub = qr.pubkey_hex.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = relay::notify_friendship(&fid, &fpub).await {
            eprintln!("[relay] notify_friendship failed: {e}");
        }
    });

    Ok(Friend {
        user_id: qr.user_id,
        nickname: qr.nickname,
        added_at: now(),
        blocked_at: None,
        note: trimmed_note,
    })
}

#[tauri::command]
pub fn set_nickname(user_id: String, nickname: String) -> Result<(), String> {
    let db = db::get().lock().unwrap();
    db.execute(
        "UPDATE friends SET nickname = ?1 WHERE user_id = ?2",
        params![nickname, user_id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn block_friend(user_id: String) -> Result<(), String> {
    let db = db::get().lock().unwrap();
    db.execute(
        "UPDATE friends SET blocked_at = ?1 WHERE user_id = ?2",
        params![now(), user_id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// ─── Messages ─────────────────────────────────────────────────────────────────

fn convo_id(a: &str, b: &str) -> String {
    let mut parts = [a, b];
    parts.sort();
    parts.join("-")
}

#[tauri::command]
pub fn get_conversations() -> Result<Vec<Conversation>, String> {
    let db = db::get().lock().unwrap();
    let my_id: String = db
        .query_row("SELECT user_id FROM identity LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT f.user_id, f.nickname,
                    (SELECT plaintext FROM messages m WHERE m.conversation_id = f.user_id || '-' || ?1 OR m.conversation_id = ?1 || '-' || f.user_id ORDER BY timestamp DESC LIMIT 1),
                    (SELECT timestamp FROM messages m WHERE m.conversation_id = f.user_id || '-' || ?1 OR m.conversation_id = ?1 || '-' || f.user_id ORDER BY timestamp DESC LIMIT 1),
                    0
             FROM friends f WHERE f.blocked_at IS NULL
             ORDER BY 4 DESC NULLS LAST",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![my_id], |row| {
            Ok(Conversation {
                friend_id: row.get(0)?,
                nickname: row.get(1)?,
                last_message: row.get(2)?,
                last_message_at: row.get(3)?,
                unread_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_messages(friend_id: String) -> Result<Vec<Message>, String> {
    let db = db::get().lock().unwrap();
    let my_id: String = db
        .query_row("SELECT user_id FROM identity LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let cid = convo_id(&my_id, &friend_id);
    let mut stmt = db
        .prepare(
            "SELECT id, conversation_id, sender_id, plaintext, timestamp, status
             FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![cid], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                sender_id: row.get(2)?,
                plaintext: row.get(3)?,
                timestamp: row.get(4)?,
                status: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn send_message(friend_id: String, content: String) -> Result<Message, String> {
    let db = db::get().lock().unwrap();
    let my_id: String = db
        .query_row("SELECT user_id FROM identity LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let cid = convo_id(&my_id, &friend_id);
    let ts = now();

    db.execute(
        "INSERT INTO messages (id, conversation_id, sender_id, plaintext, timestamp, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'sent')",
        params![id, cid, my_id, content, ts],
    )
    .map_err(|e| e.to_string())?;
    drop(db);

    // Fire-and-forget relay push (non-blocking)
    let fid = friend_id.clone();
    let txt = content.clone();
    tauri::async_runtime::spawn(async move {
        crate::relay::send_message(&fid, &txt, "dm").await.ok();
    });

    Ok(Message {
        id,
        conversation_id: cid,
        sender_id: my_id,
        plaintext: content,
        timestamp: ts,
        status: "sent".into(),
    })
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_feed() -> Result<Vec<Post>, String> {
    let db = db::get().lock().unwrap();
    let ts = now();
    let mut stmt = db
        .prepare(
            "SELECT id, author_id, content, timestamp, expires_at, is_own
             FROM posts
             WHERE expires_at IS NULL OR expires_at > ?1
             ORDER BY timestamp DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    let posts: Vec<Post> = stmt
        .query_map(params![ts], |row| {
            Ok(Post {
                id: row.get(0)?,
                author_id: row.get(1)?,
                content: row.get(2)?,
                timestamp: row.get(3)?,
                expires_at: row.get(4)?,
                is_own: row.get::<_, i32>(5)? != 0,
                reactions: std::collections::HashMap::new(),
                my_reactions: vec![],
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    // Attach reactions
    let mut result = Vec::with_capacity(posts.len());
    for mut post in posts {
        let mut rstmt = db
            .prepare(
                "SELECT emoji, count, reacted_by_me FROM reactions WHERE post_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rxs = rstmt
            .query_map(params![post.id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, i32>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for rx in rxs {
            let (emoji, count, mine) = rx.map_err(|e| e.to_string())?;
            post.reactions.insert(emoji.clone(), count);
            if mine != 0 {
                post.my_reactions.push(emoji);
            }
        }
        result.push(post);
    }
    Ok(result)
}

#[tauri::command]
pub fn create_post(content: String, expires_in_days: Option<i64>) -> Result<Post, String> {
    let db = db::get().lock().unwrap();
    let my_id: String = db
        .query_row("SELECT user_id FROM identity LIMIT 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let ts = now();
    let expires_at = expires_in_days.map(|d| ts + d * 86400);

    db.execute(
        "INSERT INTO posts (id, author_id, content, timestamp, expires_at, is_own)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![id, my_id, content, ts, expires_at],
    )
    .map_err(|e| e.to_string())?;
    drop(db);

    // Broadcast post to friends via relay (fire-and-forget)
    let pid = id.clone();
    let txt = content.clone();
    tauri::async_runtime::spawn(async move {
        crate::relay::publish_post(&pid, &txt, ts, expires_at).await.ok();
    });

    Ok(Post {
        id,
        author_id: my_id,
        content,
        timestamp: ts,
        expires_at,
        is_own: true,
        reactions: std::collections::HashMap::new(),
        my_reactions: vec![],
    })
}

#[tauri::command]
pub fn react_to_post(post_id: String, emoji: String) -> Result<(), String> {
    let db = db::get().lock().unwrap();

    let existing: rusqlite::Result<(u32, i32)> = db.query_row(
        "SELECT count, reacted_by_me FROM reactions WHERE post_id = ?1 AND emoji = ?2",
        params![post_id, emoji],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    match existing {
        Ok((count, 1)) => {
            // Toggle off
            db.execute(
                "UPDATE reactions SET count = ?1, reacted_by_me = 0 WHERE post_id = ?2 AND emoji = ?3",
                params![count.saturating_sub(1), post_id, emoji],
            )
        }
        Ok((count, _)) => {
            db.execute(
                "UPDATE reactions SET count = ?1, reacted_by_me = 1 WHERE post_id = ?2 AND emoji = ?3",
                params![count + 1, post_id, emoji],
            )
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            db.execute(
                "INSERT INTO reactions (post_id, emoji, count, reacted_by_me) VALUES (?1, ?2, 1, 1)",
                params![post_id, emoji],
            )
        }
        Err(e) => return Err(e.to_string()),
    }
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// ─── Anon threads ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn reach_out_anon(post_id: String, first_message: String) -> Result<AnonThread, String> {
    let db = db::get().lock().unwrap();

    let (post_content, _author_id): (String, String) = db
        .query_row(
            "SELECT content, author_id FROM posts WHERE id = ?1",
            params![post_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let snippet: String = post_content.chars().take(40).collect();
    let (pub_hex, prv_hex) = crypto::generate_ephemeral_keypair();

    // Thread ID = hash of post_id + ephemeral pub
    let mut h = sha2::Sha256::new();
    sha2::Digest::update(&mut h, post_id.as_bytes());
    sha2::Digest::update(&mut h, pub_hex.as_bytes());
    let thread_id = hex::encode(&sha2::Digest::finalize(h)[..16]);

    let ts = now();

    db.execute(
        "INSERT OR IGNORE INTO anon_threads
         (id, post_id, post_snippet, ephemeral_pub_hex, ephemeral_prv_hex, is_initiator, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 'open', ?6)",
        params![thread_id, post_id, snippet, pub_hex, prv_hex, ts],
    )
    .map_err(|e| e.to_string())?;

    let msg_id = Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO anon_messages (id, thread_id, plaintext, from_author, timestamp)
         VALUES (?1, ?2, ?3, 0, ?4)",
        params![msg_id, thread_id, first_message, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(AnonThread {
        id: thread_id,
        post_id,
        post_snippet: snippet,
        is_initiator: true,
        status: "open".into(),
        created_at: ts,
        last_message: Some(first_message),
        last_message_at: Some(ts),
    })
}

#[tauri::command]
pub fn get_anon_threads() -> Result<Vec<AnonThread>, String> {
    let db = db::get().lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT t.id, t.post_id, t.post_snippet, t.is_initiator, t.status, t.created_at,
                    (SELECT plaintext FROM anon_messages m WHERE m.thread_id = t.id ORDER BY timestamp DESC LIMIT 1),
                    (SELECT timestamp FROM anon_messages m WHERE m.thread_id = t.id ORDER BY timestamp DESC LIMIT 1)
             FROM anon_threads t ORDER BY t.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AnonThread {
                id: row.get(0)?,
                post_id: row.get(1)?,
                post_snippet: row.get(2)?,
                is_initiator: row.get::<_, i32>(3)? != 0,
                status: row.get(4)?,
                created_at: row.get(5)?,
                last_message: row.get(6)?,
                last_message_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_anon_messages(thread_id: String) -> Result<Vec<AnonMessage>, String> {
    let db = db::get().lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, thread_id, plaintext, from_author, timestamp
             FROM anon_messages WHERE thread_id = ?1 ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![thread_id], |row| {
            Ok(AnonMessage {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                plaintext: row.get(2)?,
                from_author: row.get::<_, i32>(3)? != 0,
                timestamp: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn send_anon_message(thread_id: String, content: String) -> Result<AnonMessage, String> {
    let db = db::get().lock().unwrap();

    let is_initiator: i32 = db
        .query_row(
            "SELECT is_initiator FROM anon_threads WHERE id = ?1",
            params![thread_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let from_author = if is_initiator == 1 { 0i32 } else { 1i32 };
    let id = Uuid::new_v4().to_string();
    let ts = now();

    db.execute(
        "INSERT INTO anon_messages (id, thread_id, plaintext, from_author, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, thread_id, content, from_author, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(AnonMessage {
        id,
        thread_id,
        plaintext: content,
        from_author: from_author != 0,
        timestamp: ts,
    })
}

#[tauri::command]
pub fn reveal_identity(thread_id: String) -> Result<(), String> {
    let db = db::get().lock().unwrap();
    db.execute(
        "UPDATE anon_threads SET status = 'revealed' WHERE id = ?1",
        params![thread_id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}
