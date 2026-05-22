export interface Identity {
  user_id: string;
  display_name: string | null;
  pubkey_hex: string;
}

export interface Friend {
  user_id: string;
  nickname: string | null;
  added_at: number;
  blocked_at: number | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  plaintext: string;
  timestamp: number;
  status: "sending" | "sent" | "delivered" | "read";
}

export interface Post {
  id: string;
  author_id: string;
  content: string;
  timestamp: number;
  expires_at: number | null;
  is_own: boolean;
  reactions: Record<string, number>;
  my_reactions: string[];
}

export interface AnonThread {
  id: string;
  post_id: string;
  post_snippet: string;
  is_initiator: boolean;
  status: "open" | "revealed" | "closed";
  created_at: number;
  last_message: string | null;
  last_message_at: number | null;
}

export interface AnonMessage {
  id: string;
  thread_id: string;
  plaintext: string;
  from_author: boolean;
  timestamp: number;
}

export interface Conversation {
  friend_id: string;
  nickname: string | null;
  last_message: string | null;
  last_message_at: number | null;
  unread_count: number;
}
