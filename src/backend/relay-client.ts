import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import { signMessage } from "./crypto";
import * as storage from "./storage";

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_URL = "https://murmur.bajzc.com";

function serverUrl(): string {
  return (import.meta as any).env?.VITE_RELAY_URL ?? DEFAULT_URL;
}

function wsUrl(): string {
  return serverUrl().replace("http://", "ws://").replace("https://", "wss://");
}

let sessionToken: string | null = null;
let wsSocket: WebSocket | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
  const res = await fetch(`${serverUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  if (res.status === 204 || method === "DELETE") return undefined as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(
  userId: string,
  pubkeyHex: string,
  privkeyHex: string
): Promise<void> {
  await apiFetch("POST", "/api/register", { user_id: userId, pubkey_hex: pubkeyHex });

  const ts = Math.floor(Date.now() / 1000);
  const msg = `${userId}:${ts}`;
  const sig = signMessage(privkeyHex, msg);

  const resp = await apiFetch<{ token: string }>("POST", "/api/auth", {
    user_id: userId,
    timestamp: ts,
    signature_hex: sig,
  });
  sessionToken = resp.token;
}

// ── Outgoing ──────────────────────────────────────────────────────────────────

export async function sendMessage(
  recipientId: string,
  plaintext: string,
  msgType: string
): Promise<void> {
  // Matches relay.rs: plaintext encoded as hex, placeholder nonce
  const payloadHex = bytesToHex(new TextEncoder().encode(plaintext));
  await apiFetch("POST", "/api/messages", {
    recipient_id: recipientId,
    payload_hex: payloadHex,
    nonce_hex: "0".repeat(24),
    msg_type: msgType,
  });
}

export async function publishPost(
  id: string,
  content: string,
  timestamp: number,
  expiresAt: number | null,
  recipientIds: string[]
): Promise<void> {
  if (recipientIds.length === 0) return;
  await apiFetch("POST", "/api/posts", {
    id,
    content,
    timestamp,
    expires_at: expiresAt,
    recipient_ids: recipientIds,
  });
}

export async function notifyFriendship(
  friendId: string,
  friendPubkeyHex: string
): Promise<void> {
  await apiFetch("POST", "/api/friends", {
    friend_id: friendId,
    friend_pubkey_hex: friendPubkeyHex,
  });
}

// ── Incoming handler ──────────────────────────────────────────────────────────

interface WsEnvelope {
  type: string;
  id?: string;
  sender_id?: string;
  payload_hex?: string;
  nonce_hex?: string;
  msg_type?: string;
  sent_at?: number;
  author_id?: string;
  content?: string;
  timestamp?: number;
  expires_at?: number | null;
}

export async function handleEnvelope(myId: string, text: string): Promise<void> {
  let env: WsEnvelope;
  try { env = JSON.parse(text); } catch { return; }

  const now = () => Math.floor(Date.now() / 1000);

  if (env.type === "message") {
    const { id, sender_id, payload_hex, msg_type = "dm", sent_at } = env;
    if (!id || !sender_id || !payload_hex) return;
    const ts = sent_at ?? now();

    // Decode plaintext (mirrors relay.rs: hex-decode the payload)
    let plaintext: string;
    try {
      plaintext = new TextDecoder().decode(hexToBytes(payload_hex));
    } catch {
      plaintext = payload_hex;
    }

    if (msg_type === "dm") {
      const parts = [sender_id, myId].sort();
      const convoId = parts.join("-");
      const existing = await storage.getMessages(convoId);
      if (!existing.find((m) => m.id === id)) {
        await storage.saveMessage({
          id, conversation_id: convoId, sender_id,
          plaintext, timestamp: ts, status: "delivered",
        });
      }
      window.dispatchEvent(new CustomEvent("chat:new_message", {
        detail: {
          friend_id: sender_id,
          message: { id, conversation_id: convoId, sender_id, plaintext, timestamp: ts, status: "delivered" },
        },
      }));
    } else if (msg_type === "anon") {
      // id format: "<thread_id>|<msg_id>"
      const sep = id.indexOf("|");
      if (sep === -1) return;
      const threadId = id.slice(0, sep);
      const msgId = id.slice(sep + 1);
      await storage.saveAnonMessage({
        id: msgId, thread_id: threadId, plaintext, from_author: 1, timestamp: ts,
      });
    }

  } else if (env.type === "delivered_ack") {
    if (env.id) await storage.updateMessageStatus(env.id, "delivered");

  } else if (env.type === "post") {
    const { id, author_id, content, timestamp, expires_at } = env;
    if (!id || !author_id || !content) return;
    const ts = timestamp ?? now();
    const existing = await storage.getPostById(id);
    if (!existing) {
      await storage.savePost({ id, author_id, content, timestamp: ts, expires_at: expires_at ?? null, is_own: 0 });
    }
    window.dispatchEvent(new CustomEvent("feed:new_post", {
      detail: { id, author_id, content, timestamp: ts, expires_at: expires_at ?? null, is_own: false },
    }));
  }
}

// ── Poll fallback ─────────────────────────────────────────────────────────────

async function pollMessages(myId: string): Promise<void> {
  const msgs: Array<{
    id: string; sender_id: string; payload_hex: string;
    nonce_hex: string; msg_type: string; sent_at: number;
  }> = await apiFetch("GET", "/api/messages");
  for (const m of msgs) {
    await handleEnvelope(myId, JSON.stringify({
      type: "message", id: m.id, sender_id: m.sender_id,
      payload_hex: m.payload_hex, nonce_hex: m.nonce_hex,
      msg_type: m.msg_type, sent_at: m.sent_at,
    }));
    await apiFetch("DELETE", `/api/messages/${m.id}`);
  }
}

async function pollPosts(myId: string): Promise<void> {
  const posts: Array<{
    id: string; author_id: string; content: string;
    timestamp: number; expires_at: number | null;
  }> = await apiFetch("GET", "/api/posts");
  for (const p of posts) {
    await handleEnvelope(myId, JSON.stringify({
      type: "post", id: p.id, author_id: p.author_id,
      content: p.content, timestamp: p.timestamp, expires_at: p.expires_at,
    }));
    await apiFetch("POST", "/api/posts/ack", { post_id: p.id });
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

export function connectWebSocket(myId: string): void {
  if (!sessionToken) return;

  const connect = () => {
    const url = `${wsUrl()}/api/ws?token=${sessionToken}`;
    const ws = new WebSocket(url);
    wsSocket = ws;

    ws.onmessage = (ev) => {
      handleEnvelope(myId, ev.data).catch(console.error);
    };
    ws.onclose = () => {
      setTimeout(connect, 5000);
    };
    ws.onerror = () => {
      ws.close();
    };
  };

  connect();

  // 60-second HTTP poll fallback
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (!sessionToken) return;
    pollMessages(myId).catch(console.error);
    pollPosts(myId).catch(console.error);
  }, 60_000);
}

export function disconnect(): void {
  wsSocket?.close();
  wsSocket = null;
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  sessionToken = null;
}
