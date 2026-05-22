import { bytesToHex } from "@noble/curves/utils.js";
import * as appCrypto from "./crypto";
import * as storage from "./storage";
import * as relay from "./relay-client";
import {
  Identity, Friend, Message, Post,
  AnonThread, AnonMessage, Conversation,
} from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const now = () => Math.floor(Date.now() / 1000);

const uuid = () => (crypto as Crypto).randomUUID();

// Mirrors commands.rs convo_id()
function convoId(a: string, b: string): string {
  return [a, b].sort().join("-");
}

// thread_id = SHA256(post_id_utf8 + pub_hex_utf8)[0..16]
// Matches commands.rs reach_out_anon: sha2::Digest::update for post_id bytes then pub_hex bytes
async function makeThreadId(postId: string, pubHex: string): Promise<string> {
  const data = new TextEncoder().encode(postId + pubHex);
  const hash = await (crypto as Crypto).subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash).slice(0, 16));
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initBackend(): Promise<void> {
  await storage.openDatabase();
  const id = await storage.getIdentity();
  if (!id) return;
  try {
    await relay.login(id.user_id, id.pubkey_hex, id.privkey_hex);
    relay.connectWebSocket(id.user_id);
  } catch {
    // Offline — app starts without server connection
  }
}

// ── Identity ──────────────────────────────────────────────────────────────────

async function getOrCreateIdentity(): Promise<Identity> {
  let id = await storage.getIdentity();
  if (!id) {
    const kp = await appCrypto.generateKeypair();
    id = {
      user_id: kp.user_id,
      pubkey_hex: kp.pubkey_hex,
      privkey_hex: kp.privkey_hex,
      display_name: null,
      created_at: now(),
    };
    await storage.saveIdentity(id);
    // Bootstrap relay in background
    relay.login(kp.user_id, kp.pubkey_hex, kp.privkey_hex)
      .then(() => relay.connectWebSocket(kp.user_id))
      .catch(() => {});
  }
  return { user_id: id.user_id, display_name: id.display_name, pubkey_hex: id.pubkey_hex };
}

async function setDisplayName(name: string): Promise<void> {
  await storage.updateDisplayName(name);
}

async function getQrPayload(): Promise<string> {
  const id = await storage.getIdentity();
  if (!id) throw new Error("No identity");
  return JSON.stringify({
    user_id: id.user_id,
    pubkey_hex: id.pubkey_hex,
    relay_address: null,
    nickname: id.display_name,
  });
}

// ── Friends ───────────────────────────────────────────────────────────────────

async function getFriends(): Promise<Friend[]> {
  const friends = await storage.getFriends();
  return friends.map((f) => ({
    user_id: f.user_id,
    nickname: f.nickname,
    added_at: f.added_at,
    blocked_at: f.blocked_at,
    note: f.note,
  }));
}

async function addFriendFromQr(payload: string, note?: string | null): Promise<Friend> {
  const qr: { user_id: string; pubkey_hex: string; relay_address?: string | null; nickname?: string | null } =
    JSON.parse(payload);
  const id = await storage.getIdentity();
  if (!id) throw new Error("No identity");
  if (qr.user_id === id.user_id) throw new Error("Cannot add yourself");

  const shared = await appCrypto.deriveSharedSecret(id.privkey_hex, qr.pubkey_hex);
  const trimmedNote = note?.trim() || null;
  const nickname = qr.nickname ?? qr.user_id.slice(0, 8);

  const friend: storage.StoredFriend = {
    user_id: qr.user_id,
    pubkey_hex: qr.pubkey_hex,
    dh_shared_hex: shared,
    nickname,
    relay_address: qr.relay_address ?? null,
    added_at: now(),
    blocked_at: null,
    note: trimmedNote,
  };
  await storage.saveFriend(friend);

  relay.notifyFriendship(qr.user_id, qr.pubkey_hex).catch(() => {});

  return {
    user_id: qr.user_id,
    nickname,
    added_at: friend.added_at,
    blocked_at: null,
    note: trimmedNote,
  };
}

async function setNickname(userId: string, nickname: string): Promise<void> {
  await storage.setFriendNickname(userId, nickname);
}

async function blockFriend(userId: string): Promise<void> {
  await storage.setFriendBlocked(userId, now());
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function getConversations(): Promise<Conversation[]> {
  const id = await storage.getIdentity();
  if (!id) return [];
  const friends = await storage.getFriends();

  const convos = await Promise.all(
    friends.map(async (f) => {
      const cid = convoId(id.user_id, f.user_id);
      const last = await storage.getLastMessage(cid);
      return {
        friend_id: f.user_id,
        nickname: f.nickname,
        last_message: last?.plaintext ?? null,
        last_message_at: last?.timestamp ?? null,
        unread_count: 0,
      } satisfies Conversation;
    })
  );

  return convos.sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0));
}

async function getMessages(friendId: string): Promise<Message[]> {
  const id = await storage.getIdentity();
  if (!id) return [];
  const cid = convoId(id.user_id, friendId);
  const msgs = await storage.getMessages(cid);
  return msgs.map((m) => ({
    id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
    plaintext: m.plaintext, timestamp: m.timestamp, status: m.status as Message["status"],
  }));
}

async function sendMessage(friendId: string, content: string): Promise<Message> {
  const id = await storage.getIdentity();
  if (!id) throw new Error("No identity");
  const msgId = uuid();
  const cid = convoId(id.user_id, friendId);
  const ts = now();
  const msg: storage.StoredMessage = {
    id: msgId, conversation_id: cid, sender_id: id.user_id,
    plaintext: content, timestamp: ts, status: "sent",
  };
  await storage.saveMessage(msg);
  relay.sendMessage(friendId, content, "dm").catch(() => {});
  return { ...msg, status: "sent" };
}

// ── Feed ──────────────────────────────────────────────────────────────────────

async function getFeed(): Promise<Post[]> {
  const posts = await storage.getPosts(now());
  return Promise.all(
    posts.map(async (p) => {
      const rxs = await storage.getReactionsForPost(p.id);
      const reactions: Record<string, number> = {};
      const myReactions: string[] = [];
      for (const r of rxs) {
        reactions[r.emoji] = r.count;
        if (r.reacted_by_me) myReactions.push(r.emoji);
      }
      return {
        id: p.id, author_id: p.author_id, content: p.content,
        timestamp: p.timestamp, expires_at: p.expires_at,
        is_own: p.is_own !== 0, reactions, my_reactions: myReactions,
      } satisfies Post;
    })
  );
}

async function createPost(content: string, expiresInDays?: number | null): Promise<Post> {
  const id = await storage.getIdentity();
  if (!id) throw new Error("No identity");
  const postId = uuid();
  const ts = now();
  const expiresAt = expiresInDays != null ? ts + expiresInDays * 86400 : null;
  await storage.savePost({ id: postId, author_id: id.user_id, content, timestamp: ts, expires_at: expiresAt, is_own: 1 });

  const friends = await storage.getFriends();
  relay.publishPost(postId, content, ts, expiresAt, friends.map((f) => f.user_id)).catch(() => {});

  return {
    id: postId, author_id: id.user_id, content, timestamp: ts,
    expires_at: expiresAt, is_own: true, reactions: {}, my_reactions: [],
  };
}

async function reactToPost(postId: string, emoji: string): Promise<void> {
  const rxs = await storage.getReactionsForPost(postId);
  const existing = rxs.find((r) => r.emoji === emoji);
  let action: "add" | "remove";
  if (existing) {
    if (existing.reacted_by_me) {
      await storage.upsertReaction({ ...existing, count: Math.max(0, existing.count - 1), reacted_by_me: 0 });
      action = "remove";
    } else {
      await storage.upsertReaction({ ...existing, count: existing.count + 1, reacted_by_me: 1 });
      action = "add";
    }
  } else {
    await storage.upsertReaction({ post_id: postId, emoji, count: 1, reacted_by_me: 1 });
    action = "add";
  }
  relay.reactToPost(postId, emoji, action).catch(() => {});
}

// ── Anon threads ──────────────────────────────────────────────────────────────

async function reachOutAnon(postId: string, firstMessage: string): Promise<AnonThread> {
  const post = await storage.getPostById(postId);
  if (!post) throw new Error("Post not found");

  const snippet = post.content.slice(0, 40);
  const { pub_hex, prv_hex } = appCrypto.generateEphemeralKeypair();
  const threadId = await makeThreadId(postId, pub_hex);
  const ts = now();

  await storage.saveAnonThread({
    id: threadId, post_id: postId, post_snippet: snippet,
    ephemeral_pub_hex: pub_hex, ephemeral_prv_hex: prv_hex,
    is_initiator: 1, status: "open" as const, created_at: ts,
  });

  const msgId = uuid();
  await storage.saveAnonMessage({
    id: msgId, thread_id: threadId, plaintext: firstMessage, from_author: 0, timestamp: ts,
  });

  return {
    id: threadId, post_id: postId, post_snippet: snippet,
    is_initiator: true, status: "open", created_at: ts,
    last_message: firstMessage, last_message_at: ts,
  };
}

async function getAnonThreads(): Promise<AnonThread[]> {
  const threads = await storage.getAnonThreads();
  return Promise.all(
    threads.map(async (t) => {
      const msgs = await storage.getAnonMessages(t.id);
      const last = msgs[msgs.length - 1];
      return {
        id: t.id, post_id: t.post_id, post_snippet: t.post_snippet,
        is_initiator: t.is_initiator !== 0, status: t.status as AnonThread["status"], created_at: t.created_at,
        last_message: last?.plaintext ?? null,
        last_message_at: last?.timestamp ?? null,
      } satisfies AnonThread;
    })
  );
}

async function getAnonMessages(threadId: string): Promise<AnonMessage[]> {
  const msgs = await storage.getAnonMessages(threadId);
  return msgs.map((m) => ({
    id: m.id, thread_id: m.thread_id, plaintext: m.plaintext,
    from_author: m.from_author !== 0, timestamp: m.timestamp,
  }));
}

async function sendAnonMessage(threadId: string, content: string): Promise<AnonMessage> {
  const thread = await storage.getAnonThreadById(threadId);
  if (!thread) throw new Error("Thread not found");
  // Mirrors commands.rs: if initiator, from_author=0; if not, from_author=1
  const fromAuthor = thread.is_initiator !== 1 ? 1 : 0;
  const id = uuid();
  const ts = now();
  await storage.saveAnonMessage({ id, thread_id: threadId, plaintext: content, from_author: fromAuthor, timestamp: ts });
  return { id, thread_id: threadId, plaintext: content, from_author: fromAuthor !== 0, timestamp: ts };
}

async function revealIdentity(threadId: string): Promise<void> {
  await storage.setAnonThreadStatus(threadId, "revealed");
}

// ── Exported command map ──────────────────────────────────────────────────────

export const browserCmd = {
  getOrCreateIdentity,
  setDisplayName,
  getQrPayload,
  getFriends,
  addFriendFromQr,
  setNickname,
  blockFriend,
  getConversations,
  getMessages,
  sendMessage,
  getFeed,
  createPost,
  reactToPost,
  reachOutAnon,
  getAnonThreads,
  getAnonMessages,
  sendAnonMessage,
  revealIdentity,
};
