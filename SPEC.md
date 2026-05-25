# Murmur — System Specification

## Goals

A private social app for real-world friend networks. Three properties drive every design decision:

1. **Offline-first** — the device works without a network; the relay is delivery infrastructure, not the source of truth.
2. **No account** — identity is a cryptographic keypair, not a username/password registered with a central authority.
3. **Selective anonymity** — the feed strips authorship at the UI layer; the anon-contact flow uses ephemeral keys so the post author genuinely cannot identify who reached out.

---

## Identity

Each device generates one Ed25519 keypair on first launch (via `crypto::generate_keypair`). The identity is permanent and stored in local SQLite.

- `user_id` = `hex(SHA256(pubkey_bytes)[0..16])` — 32-character hex string
- `pubkey_hex` / `privkey_hex` — hex-encoded Ed25519 key bytes
- `display_name` — optional, user-settable

The keypair serves two purposes: **signing** (auth challenges to the relay server) and **key agreement** (ECDH shared secrets for friends).

---

## Friend Graph

Friends are added by sharing a QR code **in person** (or by entering a user ID directly if the friend is already registered on the relay).

**QR payload** (JSON):
```json
{ "user_id": "...", "pubkey_hex": "...", "relay_address": null, "nickname": "..." }
```

**On add:**
1. Client derives `dh_shared_hex = ECDH(our_privkey, their_pubkey)` using a custom X25519 scheme: both keys are SHA256-hashed to produce X25519-compatible scalars before DH.
2. Friend row inserted into local `friends` table.
3. Relay is notified via `POST /api/friends` (fire-and-forget). Server records both directed friendship edges and queues a `friend_added` notification to the other party so they can auto-add the adder locally without a QR scan.

**Block:** sets `blocked_at` timestamp; blocked friends are excluded from all queries.

---

## Relay Server

A stateless Axum server. It does **not** store message content long-term — it is a delivery queue.

### Auth flow

Every session is authenticated:
1. Client calls `POST /api/register` (idempotent — stores pubkey).
2. Client calls `POST /api/auth` with `{user_id, timestamp, signature_hex}` where `signature = Ed25519.sign(privkey, "$user_id:$unix_ts")`. Timestamp must be within ±5 minutes (replay protection).
3. Server returns a UUID session token stored in-memory. **Server restart invalidates all sessions**; client re-auths automatically.

### Message delivery

```
POST /api/messages     — queue a DM
GET  /api/messages     — pull pending DMs (offline drain)
DEL  /api/messages/:id — ack (delete from queue)
```

On send, the server attempts live push over WebSocket. If the recipient is online, the message is delivered and acked immediately; the sender gets a `delivered_ack` envelope over their own WS. If offline, the message stays in the `pending_messages` queue until the recipient reconnects or polls.

### Post fan-out

```
POST /api/posts      — publish post to explicit recipient list
GET  /api/posts      — pull undelivered posts
POST /api/posts/ack  — mark post delivered
```

Posts are fan-out at publish time: the author sends `recipient_ids` (their friend list). Server pushes to any online recipients immediately and queues for the rest. Posts carry an optional `expires_at`; the server skips expired posts on pull.

### WebSocket

```
WS /api/ws?token=...
```

On connect: server drains all pending messages and posts for the user, then stays open for push. The client maintains a reconnect loop (5 s backoff). An HTTP poll fallback runs every 60 s in parallel as a belt-and-suspenders guarantee.

---

## Direct Messaging

`conversation_id` = `sort([my_id, friend_id]).join("-")` — deterministic, no server involvement.

**Send path:**
1. Message written to local `messages` table with `status='sent'`.
2. Relay push fired async (fire-and-forget): `POST /api/messages` with `payload_hex = hex(plaintext)`. Real E2E encryption using the `dh_shared_hex` is a future phase — currently the message is sent as plaintext over HTTPS.

**Receive path:**
- WS: `handle_ws_message` inserts into `messages` with `status='delivered'` and emits `chat:new_message` Tauri event.
- HTTP poll: same path, triggered every 60 s.
- `delivered_ack`: when the server confirms live delivery, sender's local record is updated to `status='delivered'`.

---

## Anonymous Feed

Posts are stored locally without a meaningful author display — the UI shows `#anon` for all posts. Anonymity is **social** (your friends can't tell which of them posted what) but not cryptographic at the post level.

**Create post:** stored locally as `is_own=1`, then broadcast to friends via relay.

**Receive post:** stored as `is_own=0`. The `author_id` field is stored but not shown in the UI.

**Reactions:** Toggle on/off, stored in `reactions` table keyed by `(post_id, emoji)`.

**Expiry:** posts carry optional `expires_at`; `get_feed` filters them out via SQL `WHERE expires_at IS NULL OR expires_at > now()`.

---

## Anonymous Contact (Anon Threads)

When a viewer wants to reach out to a post's author anonymously:

1. Client generates an **ephemeral X25519 keypair** (`crypto::generate_ephemeral_keypair`).
2. `thread_id = hex(SHA256(post_id_bytes + ephemeral_pub_bytes)[0..16])`.
3. First message inserted into `anon_messages` with `from_author=0` (initiator is not the author).
4. Thread stored locally with `is_initiator=1`, `status='open'`.

Wire transport for anon messages reuses the DM path with `msg_type='anon'` and a composite message ID of `"<thread_id>|<msg_id>"`.

**`from_author` semantics:** from the initiator's perspective, `from_author=false` means "I sent this"; `from_author=true` means "the post author sent this." The Rust command `send_anon_message` sets `from_author = !is_initiator`.

**Reveal:** either party can call `reveal_identity`, which sets `status='revealed'` locally. There is no cryptographic enforcement — this is a UI-level convention.

---

## Wire Format

All messages on the relay use a JSON envelope:

```json
// DM / anon
{ "type": "message", "id": "...", "sender_id": "...", "payload_hex": "...",
  "nonce_hex": "...", "msg_type": "dm|anon|friend_added", "sent_at": 1234567890 }

// Post
{ "type": "post", "id": "...", "author_id": "...", "content": "...",
  "timestamp": 1234567890, "expires_at": null }

// Ack (server → sender)
{ "type": "delivered_ack", "id": "..." }
```

`payload_hex` currently carries `hex(plaintext_utf8)`. The `nonce_hex` field is a placeholder (`"000..."`). Real ChaCha20-Poly1305 encryption using `dh_shared_hex` is deferred.

---

## Local Database (per device)

| Table | Key columns | Purpose |
|---|---|---|
| `identity` | `user_id` | Single-row self identity + keypair |
| `friends` | `user_id` | Contacts, ECDH shared secret, block state |
| `messages` | `id` | All DMs, indexed by `(conversation_id, timestamp)` |
| `posts` | `id` | Feed posts, indexed by `timestamp DESC` |
| `reactions` | `(post_id, emoji)` | Local-only reaction counts |
| `anon_threads` | `id` | Ephemeral keypairs + thread metadata |
| `anon_messages` | `id` | Anon thread messages |

---

## Server Database

| Table | Key columns | Purpose |
|---|---|---|
| `users` | `user_id` | Registered pubkeys |
| `pending_messages` | `id` | Queued DMs for offline recipients |
| `posts` | `id` | Published posts |
| `post_deliveries` | `(post_id, recipient_id)` | Per-recipient delivery tracking |
| `friendships` | `(user_a, user_b)` | Directed friendship edges (one row per direction) |

---
