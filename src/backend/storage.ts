import { openDB, DBSchema, IDBPDatabase } from "idb";

// ── Schema ────────────────────────────────────────────────────────────────────
// Mirrors the SQLite schema in db.rs.

export interface StoredIdentity {
  user_id: string;
  pubkey_hex: string;
  privkey_hex: string;
  display_name: string | null;
  created_at: number;
}

export interface StoredFriend {
  user_id: string;
  pubkey_hex: string;
  dh_shared_hex: string;
  nickname: string | null;
  relay_address: string | null;
  added_at: number;
  blocked_at: number | null;
  note: string | null;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  plaintext: string;
  timestamp: number;
  status: string;
}

export interface StoredPost {
  id: string;
  author_id: string;
  content: string;
  timestamp: number;
  expires_at: number | null;
  is_own: number; // 0 | 1 — matches SQLite INTEGER
}

export interface StoredReaction {
  post_id: string;
  emoji: string;
  count: number;
  reacted_by_me: number; // 0 | 1
}

export interface StoredAnonThread {
  id: string;
  post_id: string;
  post_snippet: string;
  ephemeral_pub_hex: string;
  ephemeral_prv_hex: string | null;
  is_initiator: number; // 0 | 1
  status: string;
  created_at: number;
}

export interface StoredAnonMessage {
  id: string;
  thread_id: string;
  plaintext: string;
  from_author: number; // 0 | 1
  timestamp: number;
}

interface AppDB extends DBSchema {
  identity: { key: string; value: StoredIdentity };
  friends: {
    key: string;
    value: StoredFriend;
    indexes: { by_added_at: number };
  };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { by_conv_ts: [string, number] };
  };
  posts: {
    key: string;
    value: StoredPost;
    indexes: { by_ts: number };
  };
  reactions: {
    key: [string, string]; // [post_id, emoji]
    value: StoredReaction;
    indexes: { by_post: string };
  };
  anon_threads: {
    key: string;
    value: StoredAnonThread;
    indexes: { by_created_at: number };
  };
  anon_messages: {
    key: string;
    value: StoredAnonMessage;
    indexes: { by_thread_ts: [string, number] };
  };
}

let _db: IDBPDatabase<AppDB> | null = null;

export async function openDatabase(): Promise<IDBPDatabase<AppDB>> {
  if (_db) return _db;
  _db = await openDB<AppDB>("socialapp", 1, {
    upgrade(db) {
      db.createObjectStore("identity", { keyPath: "user_id" });

      const friends = db.createObjectStore("friends", { keyPath: "user_id" });
      friends.createIndex("by_added_at", "added_at");

      const messages = db.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("by_conv_ts", ["conversation_id", "timestamp"]);

      const posts = db.createObjectStore("posts", { keyPath: "id" });
      posts.createIndex("by_ts", "timestamp");

      const reactions = db.createObjectStore("reactions", {
        keyPath: ["post_id", "emoji"],
      });
      reactions.createIndex("by_post", "post_id");

      const anonThreads = db.createObjectStore("anon_threads", { keyPath: "id" });
      anonThreads.createIndex("by_created_at", "created_at");

      const anonMessages = db.createObjectStore("anon_messages", { keyPath: "id" });
      anonMessages.createIndex("by_thread_ts", ["thread_id", "timestamp"]);
    },
  });
  return _db;
}

// ── Identity ──────────────────────────────────────────────────────────────────

export async function getIdentity(): Promise<StoredIdentity | undefined> {
  const db = await openDatabase();
  const all = await db.getAll("identity");
  return all[0];
}

export async function saveIdentity(id: StoredIdentity): Promise<void> {
  const db = await openDatabase();
  await db.put("identity", id);
}

export async function updateDisplayName(name: string): Promise<void> {
  const db = await openDatabase();
  const id = await getIdentity();
  if (!id) return;
  await db.put("identity", { ...id, display_name: name });
}

// ── Friends ───────────────────────────────────────────────────────────────────

export async function getFriends(): Promise<StoredFriend[]> {
  const db = await openDatabase();
  const all = await db.getAllFromIndex("friends", "by_added_at");
  return all.filter((f) => f.blocked_at === null).reverse();
}

export async function getFriendById(userId: string): Promise<StoredFriend | undefined> {
  const db = await openDatabase();
  return db.get("friends", userId);
}

export async function saveFriend(f: StoredFriend): Promise<void> {
  const db = await openDatabase();
  await db.put("friends", f);
}

export async function setFriendBlocked(userId: string, blockedAt: number): Promise<void> {
  const db = await openDatabase();
  const f = await db.get("friends", userId);
  if (f) await db.put("friends", { ...f, blocked_at: blockedAt });
}

export async function setFriendNickname(userId: string, nickname: string): Promise<void> {
  const db = await openDatabase();
  const f = await db.get("friends", userId);
  if (f) await db.put("friends", { ...f, nickname });
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  const db = await openDatabase();
  const range = IDBKeyRange.bound(
    [conversationId, 0],
    [conversationId, Infinity]
  );
  return db.getAllFromIndex("messages", "by_conv_ts", range);
}

export async function getLastMessage(conversationId: string): Promise<StoredMessage | undefined> {
  const msgs = await getMessages(conversationId);
  return msgs[msgs.length - 1];
}

export async function saveMessage(m: StoredMessage): Promise<void> {
  const db = await openDatabase();
  await db.put("messages", m);
}

export async function updateMessageStatus(id: string, status: string): Promise<void> {
  const db = await openDatabase();
  const m = await db.get("messages", id);
  if (m) await db.put("messages", { ...m, status });
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export async function getPosts(nowTs: number): Promise<StoredPost[]> {
  const db = await openDatabase();
  const all = await db.getAllFromIndex("posts", "by_ts");
  return all
    .filter((p) => p.expires_at === null || p.expires_at > nowTs)
    .reverse()
    .slice(0, 100);
}

export async function getPostById(id: string): Promise<StoredPost | undefined> {
  const db = await openDatabase();
  return db.get("posts", id);
}

export async function savePost(p: StoredPost): Promise<void> {
  const db = await openDatabase();
  await db.put("posts", p);
}

// ── Reactions ─────────────────────────────────────────────────────────────────

export async function getReactionsForPost(postId: string): Promise<StoredReaction[]> {
  const db = await openDatabase();
  return db.getAllFromIndex("reactions", "by_post", postId);
}

export async function upsertReaction(r: StoredReaction): Promise<void> {
  const db = await openDatabase();
  await db.put("reactions", r);
}

// ── Anon threads ──────────────────────────────────────────────────────────────

export async function getAnonThreads(): Promise<StoredAnonThread[]> {
  const db = await openDatabase();
  const all = await db.getAllFromIndex("anon_threads", "by_created_at");
  return all.reverse();
}

export async function getAnonThreadById(id: string): Promise<StoredAnonThread | undefined> {
  const db = await openDatabase();
  return db.get("anon_threads", id);
}

export async function saveAnonThread(t: StoredAnonThread): Promise<void> {
  const db = await openDatabase();
  await db.put("anon_threads", t);
}

export async function setAnonThreadStatus(id: string, status: string): Promise<void> {
  const db = await openDatabase();
  const t = await db.get("anon_threads", id);
  if (t) await db.put("anon_threads", { ...t, status });
}

export async function getAnonMessages(threadId: string): Promise<StoredAnonMessage[]> {
  const db = await openDatabase();
  const range = IDBKeyRange.bound([threadId, 0], [threadId, Infinity]);
  return db.getAllFromIndex("anon_messages", "by_thread_ts", range);
}

export async function saveAnonMessage(m: StoredAnonMessage): Promise<void> {
  const db = await openDatabase();
  await db.put("anon_messages", m);
}
