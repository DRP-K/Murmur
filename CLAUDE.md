# Social App — Concept & Implementation Plan

## App Concept

An offline-first social app built with Tauri (Rust backend, web frontend).

### Core Features

1. **Offline Friend Adding via QR Code**
   - Generate a QR code containing your user ID / public key
   - Scan a friend's QR code in person to add them (no server needed for the handshake)
   - Exchange encrypted contact info peer-to-peer (Bluetooth or local Wi-Fi, or a relay)

2. **Direct Messaging (WhatsApp-style)**
   - End-to-end encrypted chat with confirmed friends
   - Messages, media, read receipts
   - Works over internet once friends are added

3. **Anonymous Feed**
   - All friends post to a shared feed
   - Posts show no names or avatars — fully anonymous by default
   - You can read, react, or reach out to the post author anonymously
   - If the author replies, a temporary anonymous chat thread opens
   - Author can choose to reveal identity at any point; so can you

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Tauri 2 (Rust + WebView) | Cross-platform, small binary, Rust safety |
| Frontend | React + TypeScript + Tailwind | Fast UI dev, good component ecosystem |
| Backend (local) | Rust (Tauri commands) | Crypto, QR, local DB |
| Local DB | SQLite via `rusqlite` | Offline-first, embedded |
| Crypto | `libsodium` / `ring` crate | Key generation, E2E encryption |
| Networking | `libp2p` or WebSocket relay | P2P or server-relayed messaging |
| QR Code | `qrcode` crate (backend) + `jsQR` (frontend scan) | Generate + scan in-app |

---

## Implementation Plan

### Phase 1 — Identity & QR Friend Add

- [ ] Generate an Ed25519 keypair on first launch; store in local SQLite
- [ ] Display own QR code (encodes: `userID`, `pubkey`, `relay address`)
- [ ] Camera view to scan friend's QR code
- [ ] Store friend record (`id`, `pubkey`, `nickname`, `added_at`) in SQLite
- [ ] Tauri commands: `generate_identity`, `get_qr_payload`, `add_friend_from_qr`

### Phase 2 — Encrypted Direct Messaging

- [ ] Key exchange (X25519 ECDH) when friend is first added
- [ ] Message struct: `{ id, sender, recipient, ciphertext, timestamp, status }`
- [ ] Local message store in SQLite
- [ ] Relay server (minimal Rust/Axum WebSocket server) for delivery when both online
- [ ] Frontend chat UI: conversation list, message thread, send bar
- [ ] Tauri commands: `send_message`, `get_conversation`, `mark_read`

### Phase 3 — Anonymous Feed

- [ ] Post struct: `{ id, author_id_encrypted, content, timestamp, reactions }`
- [ ] Author ID encrypted with a symmetric key shared among all friends (group key)
- [ ] Feed view: show posts with no author info; reactions visible
- [ ] "Reach out anonymously" button → opens ephemeral anon thread
  - Thread ID derived from post ID + your ephemeral keypair
  - Author can see someone messaged them but not who
- [ ] Identity reveal: both sides can optionally unmask
- [ ] Tauri commands: `create_post`, `get_feed`, `react_to_post`, `open_anon_thread`

### Phase 4 — Polish & Privacy

- [ ] Notification system (Tauri notifications API)
- [ ] Post expiry (posts auto-delete after N days)
- [ ] Block / remove friend
- [ ] Settings: display name, avatar (shown only to confirmed friends)
- [ ] Optional: local-only mode (no relay, LAN only via mDNS)

---

## Project Structure (target)

```
src/                   # Frontend (React + TS)
  components/
    QRScanner.tsx
    QRDisplay.tsx
    ChatThread.tsx
    Feed.tsx
    AnonThread.tsx
  pages/
    Friends.tsx
    Chat.tsx
    Feed.tsx
    Settings.tsx
  store/               # Zustand or Redux state

src-tauri/src/         # Rust backend
  commands/
    identity.rs
    friends.rs
    messages.rs
    feed.rs
  db.rs                # SQLite setup & migrations
  crypto.rs            # Keypair, encrypt, decrypt
  relay.rs             # WebSocket client
  main.rs
```

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
- `[+]` opens compose sheet
- `<3` = like reaction, `~` = resonates reaction
- `[Reach]` triggers the anon contact modal

---

### Screen 2 — Reach out modal
```
┌──────────────────────────────┐
│ 9:41                    |||  │
├──────────────────────────────┤
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
│                              │
├──────────────────────────────┤
│ [Feed]  Chats  Friends   Me  │
└──────────────────────────────┘
```
- Thread only appears in both users' Chats if the author replies
- If author ignores, the initiator never gets a thread (fire-and-forget)

---

### Screen 3 — Anonymous thread
```
┌──────────────────────────────┐
│ 9:41                    |||  │
├──────────────────────────────┤
│  <  Anonymous thread    [i]  │
│     re: "got the job" post   │
├──────────────────────────────┤
│  -- both identities hidden --│
│                              │
│            ┌───────────────┐ │
│            │ Your post     │ │
│            │ made me smile │ │
│            │ today         │ │
│            └───────────────┘ │
│                  you · 10:32 │
│                              │
│  ┌────────────────────┐      │
│  │ Thank you! I was   │      │
│  │ nervous for months │      │
│  └────────────────────┘      │
│  them · 10:45                │
│                              │
│            ┌───────────────┐ │
│            │ You deserve   │ │
│            │ it :)         │ │
│            └───────────────┘ │
│                  you · 10:46 │
│                              │
│  ┌────────────────────────┐  │
│  │  [Reveal your name?]   │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│ ┌──────────────────────┐ [>] │
│ │ Type a message...    │     │
│ └──────────────────────┘     │
└──────────────────────────────┘
```
- `[Reveal your name?]` is a soft banner, not forced — either side can initiate
- Both must agree before identities are shown

---

### Screen 4 — Chats list
```
┌──────────────────────────────┐
│ 9:41                    |||  │
├──────────────────────────────┤
│  Chats                       │
├──────────────────────────────┤
│  [Search conversations...]   │
│                              │
│  ┌────────────────────────┐  │
│  │ [A] Alice              │  │
│  │     hey are you free   │  │
│  │     tomorrow?     2m   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [B] Bob            (3) │  │
│  │     ok sounds good     │  │
│  │     to me          1h  │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [C] Carol              │  │
│  │     haha yes exactly   │  │
│  │                    3h  │  │
│  └────────────────────────┘  │
│                              │
│  -- Anonymous threads --     │
│                              │
│  ┌────────────────────────┐  │
│  │ [?] "got the job" post │  │
│  │     You deserve it :)  │  │
│  │                   10m  │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│  Feed  [Chats] Friends   Me  │
└──────────────────────────────┘
```
- Named DMs at top, anonymous threads in a separate section below
- `[?]` avatar for anon threads; letter avatar for named friends

---

### Screen 5 — Add Friend (QR)
```
┌──────────────────────────────┐
│ 9:41                    |||  │
├──────────────────────────────┤
│  <  Add Friend               │
├──────────────────────────────┤
│                              │
│  [ My QR code ] [ Scan QR ] │
│  ──────────────────────────  │
│                              │
│   Show this to your friend:  │
│                              │
│   ┌──────────────────────┐   │
│   │ ▓▓▓  ░▓░▓░░  ░  ▓▓▓ │   │
│   │ ▓ ▓  ▓░░░░▓  ░  ▓ ▓ │   │
│   │ ▓ ▓  ░▓▓░░░  ░  ▓ ▓ │   │
│   │ ▓▓▓  ▓░▓▓▓▓  ░  ▓▓▓ │   │
│   │ ░░░░░░▓░░▓▓▓░░░░░░░ │   │
│   │ ▓░▓░░░░▓░░░░░▓▓░░▓▓ │   │
│   │ ▓▓▓  ░▓░▓░░  ░  ▓ ▓ │   │
│   │ ▓ ▓  ▓░▓▓░▓  ░  ▓ ▓ │   │
│   │ ▓▓▓  ░▓░░░▓  ░  ▓▓▓ │   │
│   └──────────────────────┘   │
│                              │
│   Your ID:  a3f9...c7b2      │
│   [       Copy ID          ] │
│                              │
├──────────────────────────────┤
│  Feed   Chats [Friends]  Me  │
└──────────────────────────────┘
```

Scan tab:
```
│  [ My QR code ] [ Scan QR ] │
│  ──────────────────────────  │
│                              │
│   ┌──────────────────────┐   │
│   │                      │   │
│   │    (camera feed)     │   │
│   │                      │   │
│   │   - - - - - - - - -  │   │
│   │  |                 | │   │
│   │  |   align here    | │   │
│   │  |                 | │   │
│   │   - - - - - - - - -  │   │
│   │                      │   │
│   └──────────────────────┘   │
│                              │
│  Or enter ID manually:       │
│  ┌────────────────────────┐  │
│  │ Paste friend's ID...   │  │
│  └────────────────────────┘  │
│  [       Add Friend        ] │
```

---

## Key Design Decisions

- **Offline-first**: all data lives in local SQLite; relay is only for delivery
- **No phone number or email required**: identity is a keypair, shared via QR
- **Feed anonymity**: enforced cryptographically, not just by UI policy
- **Anonymous contact**: ephemeral keypairs mean even the relay can't correlate sender to identity
