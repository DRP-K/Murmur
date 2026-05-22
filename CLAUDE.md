# Social App

An offline-first social app built with Tauri 2 (Rust + React).

---

## Core Features

1. **Offline Friend Adding via QR Code** — generate/scan QR in person, no server needed for the handshake
2. **Direct Messaging** — WhatsApp-style E2E encrypted chat over a relay
3. **Anonymous Feed** — friends post without names; react or reach out anonymously; identity reveal is opt-in

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Tauri 2 (Rust + WebView) |
| Frontend | React 19 + TypeScript + Tailwind CSS 3 |
| State | Zustand |
| Local DB | SQLite via `rusqlite` (bundled) |
| Crypto | `ed25519-dalek`, `x25519-dalek`, `chacha20poly1305` |
| Relay server | Rust + Axum + WebSocket (`server/`) |
| QR generate | `qrcode` npm package |
| QR scan | `jsQR` + browser camera API |

---

## Project Structure

```
tauri-app/
├── index.html
├── src/                          # React frontend
│   ├── main.tsx
│   ├── App.tsx                   # Tab router + identity bootstrap
│   ├── index.css                 # Tailwind base
│   ├── types.ts                  # Shared TypeScript types
│   ├── store.ts                  # Zustand global state
│   ├── commands.ts               # Typed wrappers for invoke()
│   ├── components/
│   │   ├── BottomNav.tsx
│   │   ├── Header.tsx
│   │   ├── ChatBubble.tsx        # Shared bubble renderer (grouping, tails, timestamps)
│   │   ├── MessageInput.tsx      # Auto-grow textarea + send button
│   │   ├── ComposeModal.tsx      # New post sheet
│   │   └── ReachOutModal.tsx     # Anonymous contact modal
│   └── pages/
│       ├── Feed.tsx
│       ├── Chats.tsx
│       ├── ChatThread.tsx
│       ├── AnonThread.tsx
│       ├── Friends.tsx
│       ├── AddFriend.tsx         # QR display + camera scan tabs
│       └── Me.tsx
│
├── src-tauri/src/                # Rust backend (Tauri commands)
│   ├── lib.rs                    # Builder, DB init, relay bootstrap
│   ├── main.rs
│   ├── db.rs                     # SQLite schema + seed data
│   ├── crypto.rs                 # Keypair gen, ECDH, ephemeral keys
│   ├── commands.rs               # All 17 Tauri commands
│   └── relay.rs                  # HTTP + WebSocket client to server/
│
└── server/src/                   # Standalone relay server
    ├── main.rs                   # Axum router, WebSocket handler
    ├── db.rs                     # Server-side SQLite (pending msgs, posts)
    └── auth.rs                   # Ed25519 challenge-response, session tokens
```

---

## Database Schema (local, per device)

```sql
identity         -- one row: user_id, pubkey_hex, privkey_hex, display_name
friends          -- user_id, pubkey_hex, dh_shared_hex, nickname, added_at
messages         -- id, conversation_id, sender_id, plaintext, timestamp, status
posts            -- id, author_id, content, timestamp, expires_at, is_own
reactions        -- post_id, emoji, count, reacted_by_me
anon_threads     -- id, post_id, post_snippet, ephemeral keys, is_initiator, status
anon_messages    -- id, thread_id, plaintext, from_author, timestamp
```

## Database Schema (server)

```sql
users            -- user_id, pubkey_hex, registered_at
pending_messages -- id, sender_id, recipient_id, payload_hex, nonce_hex, msg_type, sent_at
posts            -- id, author_id, content, timestamp, expires_at
post_deliveries  -- post_id, recipient_id, delivered
friendships      -- user_a, user_b, created_at  (directed edge; one row per direction)
```

---

## Server API

```
POST /api/register          register pubkey (idempotent)
POST /api/auth              Ed25519 challenge-response → session token
POST /api/messages          queue encrypted DM for recipient
GET  /api/messages          pull pending DMs
DEL  /api/messages/:id      ack delivery
POST /api/posts             broadcast post to recipient list
GET  /api/posts             pull undelivered posts
POST /api/posts/ack         mark post delivered
POST /api/friends           register friend pubkey + record directed friendship edge
WS   /api/ws?token=...      real-time delivery + drain on connect
```

**Auth flow:** client signs `"user_id:unix_timestamp"` with Ed25519 private key → server verifies against stored pubkey → returns UUID session token. Tokens are in-memory; server restart invalidates sessions (client re-auths automatically).

**Offline behaviour:** server queues messages for offline users; WebSocket drain fires on reconnect. App works fully offline — relay push is fire-and-forget.

---

## Running

### Start the relay server
```bash
cd server
cargo run --release
# → http://127.0.0.1:8080
```

Optional env vars:
```bash
PORT=9090 cargo run --release
# DATA_DIR defaults to the current directory (server.db written there)
# DATA_DIR=/some/path cargo run --release  ← directory must already exist
```

### Start the Tauri app
```bash
npm run tauri dev
# Override server URL:
RELAY_URL=http://localhost:9090 npm run tauri dev
```

---

## Implementation Status

### Done
- [x] Ed25519 identity generation on first launch
- [x] QR code generation (`qrcode` npm) + camera scan (`jsQR`)
- [x] `add_friend_from_qr` — ECDH shared secret derived on add
- [x] Local SQLite for all data (offline-first)
- [x] All 17 Tauri commands (identity, friends, DMs, feed, anon threads)
- [x] Relay server (Axum + WebSocket) with auth, message queue, post fan-out
- [x] `relay.rs` client — login, send_message, publish_post, WS listener
- [x] Full React UI — Feed, Chats, ChatThread, AnonThread, Friends, AddFriend, Me
- [x] ChatBubble component — grouping, tails, avatars, timestamps, date separators, status ticks
- [x] Seed data for demo (friends, posts, messages)
- [x] **Phase 1** — `get_or_create_identity` spawns `relay::bootstrap` on first-time identity creation
- [x] **Phase 2** — `add_friend_from_qr` calls `relay::notify_friendship` after local DB insert; server records `friendships` edge and upserts friend pubkey via `POST /api/friends`
- [x] **Phase 3** — `handle_ws_message` emits `chat:new_message` and `feed:new_post` Tauri events; `ChatThread.tsx` listens and appends live; server pushes `delivered_ack` back to sender; `poll_messages()` runs every 60 s as HTTP fallback
- [x] **Phase 4** — `Feed.tsx` listens for `feed:new_post` and prepends live; `poll_posts()` runs every 60 s as HTTP fallback alongside `poll_messages()`

### Backend integration plan (next)

**Phase 5 — Remove dummy data**
- [ ] Delete `seed_demo_friends()`, `seed_demo_posts()`, `seed_demo_messages()` from `db.rs`
- [ ] Remove all three calls from `db::init()`
- [ ] Delete `~/Library/Application Support/com.socialapp.app/social.db` to start clean

---

## UI Screens

### Screen 1 — Feed (anonymous)
```
┌──────────────────────────────┐
│ 9:41                    |||  │
├──────────────────────────────┤
│  Feed                   [+] │
├──────────────────────────────┤
│                              │
│  ┌────────────────────────┐  │
│  │ # anon          2h ago │  │
│  │ Just saw the most      │  │
│  │ beautiful sunset from  │  │
│  │ the park today...      │  │
│  │                        │  │
│  │ <3 12   ~ 3   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ # anon          5h ago │  │
│  │ Anyone feel like       │  │
│  │ everything is moving   │  │
│  │ too fast lately?       │  │
│  │                        │  │
│  │ <3 8    ~ 5   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ # anon          1d ago │  │
│  │ Got the job!! Finally. │  │
│  │                        │  │
│  │ <3 31   ~ 7   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│ [Feed]  Chats  Friends   Me  │
└──────────────────────────────┘
```
- `[+]` opens compose sheet (anonymous post)
- `<3` = like, `~` = resonates
- `[Reach]` triggers the anon contact modal

---

### Screen 2 — Reach out modal
```
┌──────────────────────────────┐
│  Feed                   [+] │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ # anon  · Got the job! │  │
│  │ <3 31   ~ 7   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
│  ╔════════════════════════╗  │
│  ║  Reach anonymously?    ║  │
│  ║                        ║  │
│  ║  They won't know it's  ║  │
│  ║  you. A thread opens   ║  │
│  ║  only if they reply.   ║  │
│  ║                        ║  │
│  ║  ┌────────────────┐    ║  │
│  ║  │ Your post made │    ║  │
│  ║  │ me smile today │    ║  │
│  ║  └────────────────┘    ║  │
│  ║                        ║  │
│  ║  [Cancel]    [Send >]  ║  │
│  ╚════════════════════════╝  │
└──────────────────────────────┘
```
- Thread only appears in Chats if the author replies
- Fire-and-forget if author ignores

---

### Screen 3 — Anonymous thread
```
┌──────────────────────────────┐
│  <  Anonymous thread    [i]  │
│     re: "got the job" post   │
├──────────────────────────────┤
│  -- both identities hidden --│
│                              │
│            ┌───────────────┐ │
│            │ Your post     │ │
│            │ made me smile │ │
│            └───────────────┘ │
│                  you · 10:32 │
│  ┌────────────────────┐      │
│  │ Thank you! I was   │      │
│  │ nervous for months │      │
│  └────────────────────┘      │
│  them · 10:45                │
│  ┌────────────────────────┐  │
│  │  [Reveal your name?]   │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│ ┌──────────────────────┐ [>] │
│ │ Type a message...    │     │
│ └──────────────────────┘     │
└──────────────────────────────┘
```
- `[Reveal your name?]` is soft — either side initiates, both must agree

---

### Screen 4 — Chats list
```
┌──────────────────────────────┐
│  Chats                       │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ [A] Alice              │  │
│  │     hey are you free   │  │
│  │     tomorrow?     2m   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [B] Bob            (3) │  │
│  │     ok sounds good 1h  │  │
│  └────────────────────────┘  │
│                              │
│  -- Anonymous threads --     │
│                              │
│  ┌────────────────────────┐  │
│  │ [?] "got the job" post │  │
│  │     You deserve it :)  │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│  Feed  [Chats] Friends   Me  │
└──────────────────────────────┘
```

---

### Screen 5 — Add Friend (QR)
```
┌──────────────────────────────┐
│  <  Add Friend               │
├──────────────────────────────┤
│  [ My QR code ] [ Scan QR ] │
│  ──────────────────────────  │
│   Show this to your friend:  │
│   ┌──────────────────────┐   │
│   │ ▓▓▓  ░▓░▓░░  ░  ▓▓▓ │   │
│   │ ▓ ▓  ▓░░░░▓  ░  ▓ ▓ │   │
│   │ ▓▓▓  ░▓░░░▓  ░  ▓▓▓ │   │
│   └──────────────────────┘   │
│   Your ID:  a3f9...c7b2      │
│   [       Copy ID          ] │
├──────────────────────────────┤
│  Feed   Chats [Friends]  Me  │
└──────────────────────────────┘
```

---

## Key Design Decisions

- **Offline-first**: all data lives in local SQLite; relay is delivery-only
- **No account required**: identity is an Ed25519 keypair, shared via QR
- **Feed anonymity is UI-level on your own device** (you know who your friends are); cryptographic anonymity applies to the anon-contact flow where the *author* genuinely cannot identify who reached out (ephemeral keypairs)
- **Fire-and-forget relay**: failed relay pushes are silently dropped; server queues for offline recipients
- **Reactions are local-only** for now (no server sync needed)
