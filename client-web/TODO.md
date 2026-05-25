# Murmur Web Client — TODO

## Architecture Decisions

- **IndexedDB scope**: only keypair + anon-thread ephemeral keys stored locally (Dexie).
  All other data (posts, messages, friends) is fetched from the relay each session.
  Rationale: relay already stores everything; no benefit in full offline-first for a web client.
  Caveat: acked messages are deleted from the relay — no history after reading (acceptable for v1).

- **Session state**: Bearer token lives in Zustand (in-memory only). Re-created on every page
  load via Ed25519 challenge-response. Relay restart invalidates all tokens; client re-auths
  automatically on any 401.

- **Single write path**: WS dispatch and HTTP poll both call the same handler, which writes
  to React state. Components never subscribe to WS directly.

- **No Redux/Context for domain data**: fetched data lives in component/page state via
  useState/useReducer. Zustand is only for cross-cutting session fields.

## Tech Stack

| Concern       | Library                              |
|---------------|--------------------------------------|
| Framework     | Next.js (App Router, TypeScript)     |
| Styling       | Tailwind CSS                         |
| Local storage | Dexie.js (IndexedDB — keys only)     |
| Session state | Zustand                              |
| Crypto        | @noble/curves (Ed25519 + X25519)     |
| Hashing       | @noble/hashes (SHA-256)              |
| QR generate   | qrcode.react                         |
| QR scan       | html5-qrcode                         |
| Icons         | lucide-react                         |

## Phases

### Phase 1 — Identity & Crypto ✓
- [x] Bootstrap Next.js project
- [x] `lib/types.ts` — TypeScript types mirroring wire.rs
- [x] `lib/crypto.ts` — keypair gen, sign, ECDH, ephemeral keypair, thread_id
- [x] `lib/db.ts` — Dexie schema: `identity` + `anon_threads`
- [x] `lib/identity.ts` — first-run init, getIdentity, updateDisplayName

> **ECDH note:** SPEC describes "SHA256-hash both keys before DH" but that is not
> commutative and both sides would produce different secrets. Implementation uses the
> standard Ed25519→X25519 Montgomery conversion (`toMontgomerySecret` / `toMontgomery`).
> Sync with the native client when encryption is actually wired up.

### Phase 2 — Relay Client & WebSocket ✓
- [x] `lib/relay.ts` — typed fetch wrappers for all REST endpoints, auto-reauth on 401
- [x] `lib/store.ts` — Zustand: { userId, pubkeyHex, token, wsStatus }
- [x] `lib/ws.ts` — WebSocket manager: connect, drain on open, 5 s reconnect backoff,
      60 s HTTP poll fallback, dispatch ServerEnvelope to caller

### Phase 3 — Feed ✓
- [x] `app/feed/page.tsx` — fetch posts on load + WS subscription
- [x] `components/PostCard.tsx` — #anon, content, relative timestamp, reactions, [Reach]
- [x] `components/ComposeSheet.tsx` — new post modal, POST /api/posts to all friends
- [x] Reaction toggle (local in-memory per session, no server)
- [x] `hooks/useBootstrap.ts` — initIdentity → register → auth → WS connect
- [x] `lib/ws.ts` — refactored to subscriber pattern (multiple listeners)
- [x] `lib/db.ts` — added `friends` table for Phase 6 fan-out
- [x] `app/page.tsx` — redirects to /feed

### Phase 4 — Chats ✓
- [x] `app/chats/page.tsx` — list DMs (grouped by conversation_id) + anon threads from Dexie
- [x] `app/chats/[id]/page.tsx` — DM conversation, optimistic send
- [x] `components/MessageBubble.tsx`
- [x] `components/ChatRow.tsx`

### Phase 5 — Anon Contact ✓
- [x] `components/ReachModal.tsx` — Screen 2, ephemeral keypair generation
- [x] `app/chats/anon/[threadId]/page.tsx` — Screen 3, from_author flip logic
- [x] `hooks/useAnonSink.ts` — global WS listener that auto-creates author-side AnonThread records
- [x] Anon send/receive via DM path with msg_type='anon'

### Phase 6 — Friends ✓
- [x] Server: GET /api/friends endpoint (repository query, handler, route, integration test)
- [x] `app/friends/page.tsx` — My QR tab + Scan tab
- [x] `components/QrScanner.tsx` — camera access via html5-qrcode
- [x] Add friend: parse QR → ECDH → insert to local Dexie → POST /api/friends
- [x] Client: `getFriends` relay function + `FriendListResponse` types

### Phase 7 — Me + Bootstrap ✓
- [x] `app/me/page.tsx` — display name edit, copy user ID + pubkey
- [x] `components/TabBar.tsx` — bottom nav (Feed / Chats / Friends / Me) with active-state highlighting
- [x] `hooks/BootstrapShell.tsx` — global bootstrap (init → register → auth → WS) in root layout
- [x] `app/layout.tsx` — BootstrapShell wrapper + proper metadata
- [x] `lib/store.ts` — bootstrapped/bootstrapError flags
- [x] All pages use store bootstrapped flag instead of per-page useBootstrap
- [x] Loading/error states, redirect / → /feed
