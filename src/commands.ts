import { invoke } from "@tauri-apps/api/core";
import {
  Identity, Friend, Message, Post,
  AnonThread, AnonMessage, Conversation,
} from "./types";
import { browserCmd, initBackend } from "./backend/backend";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

if (!isTauri) {
  initBackend().catch(console.error);
}

export const cmd = isTauri ? {
  // Identity
  getOrCreateIdentity: () => invoke<Identity>("get_or_create_identity"),
  setDisplayName: (name: string) => invoke<void>("set_display_name", { name }),
  getQrPayload: () => invoke<string>("get_qr_payload"),

  // Friends
  getFriends: () => invoke<Friend[]>("get_friends"),
  addFriendFromQr: (payload: string, note?: string) =>
    invoke<Friend>("add_friend_from_qr", { payload, note: note ?? null }),
  setNickname: (userId: string, nickname: string) =>
    invoke<void>("set_nickname", { userId, nickname }),
  blockFriend: (userId: string) => invoke<void>("block_friend", { userId }),

  // Messages
  getConversations: () => invoke<Conversation[]>("get_conversations"),
  getMessages: (friendId: string) => invoke<Message[]>("get_messages", { friendId }),
  sendMessage: (friendId: string, content: string) =>
    invoke<Message>("send_message", { friendId, content }),

  // Feed
  getFeed: () => invoke<Post[]>("get_feed"),
  createPost: (content: string, expiresInDays?: number) =>
    invoke<Post>("create_post", { content, expiresInDays: expiresInDays ?? null }),
  reactToPost: (postId: string, emoji: string) =>
    invoke<void>("react_to_post", { postId, emoji }),

  // Anon threads
  reachOutAnon: (postId: string, firstMessage: string) =>
    invoke<AnonThread>("reach_out_anon", { postId, firstMessage }),
  getAnonThreads: () => invoke<AnonThread[]>("get_anon_threads"),
  getAnonMessages: (threadId: string) =>
    invoke<AnonMessage[]>("get_anon_messages", { threadId }),
  sendAnonMessage: (threadId: string, content: string) =>
    invoke<AnonMessage>("send_anon_message", { threadId, content }),
  revealIdentity: (threadId: string) => invoke<void>("reveal_identity", { threadId }),
} : browserCmd;
