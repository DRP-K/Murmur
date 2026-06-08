// Wire types matching server/src/wire.rs

export type MsgType = 'dm' | 'anon' | 'friend_added'

export interface MediaItem {
  url: string
  media_type: 'image' | 'video'
}

export type ServerEnvelope =
  | {
      type: 'message'
      id: string
      sender_id: string
      payload_hex: string
      nonce_hex: string
      msg_type: MsgType
      sent_at: number
    }
  | {
      type: 'post'
      id: string
      author_id: string
      content: string
      timestamp: number
      category?: string | null
      media_ref_name?: string | null
      image_url?: string | null
      attachment_url?: string | null
      attachment_type?: 'image' | 'video' | null
      attachments?: MediaItem[] | null
      rally_group_id?: string | null
      rally_max_members?: number | null
      categories?: string[]
    }
  | {
      type: 'group_message'
      id: string
      group_id: string
      sender_id: string
      payload_hex: string
      sent_at: number
    }
  | {
      type: 'group_update'
      group: GroupInfo
    }
  | { type: 'post_category_update'; post_id: string; categories: string[] }
  | { type: 'rescan_complete'; category: string }
  | { type: 'delivered_ack'; id: string }

export interface RegisterRequest {
  user_id: string
  pubkey_hex: string
}

export interface AuthRequest {
  user_id: string
  timestamp: number
  signature_hex: string
}

export interface AuthResponse {
  token: string
}

export interface SendMessageRequest {
  id: string
  recipient_id: string
  payload_hex: string
  nonce_hex: string
  msg_type: string
  sent_at: number
}

export interface MessageListResponse {
  messages: ServerEnvelope[]
}

export interface CreatePostRequest {
  id: string
  content: string
  timestamp: number
  recipient_ids: string[]
  category?: string | null
  media_ref_name?: string | null
  image_url?: string | null
  attachment_url?: string | null
  attachment_type?: string | null
  attachments?: MediaItem[] | null
  rally?: {
    group_id: string
    max_members: number
  } | null
}

export interface PostAssistRequest {
  prefix: string
}

export interface PostAssistResponse {
  completed_content: string
  category: 'movies' | 'music' | 'games' | null
  media_ref_name: string | null
}

export interface PostListResponse {
  posts: ServerEnvelope[]
}

export interface AckPostRequest {
  post_id: string
}

export interface AddFriendRequest {
  friend_id: string
}

// Client-side shaped types (after receiving from server)

export interface Post {
  id: string
  author_id: string
  content: string
  timestamp: number
  is_own: boolean
  category?: string | null
  media_ref_name?: string | null
  image_url?: string | null
  attachment_url?: string | null
  attachment_type?: 'image' | 'video' | null
  attachments?: MediaItem[] | null
  rally_group_id?: string | null
  rally_max_members?: number | null
  categories: string[]
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  payload_hex: string
  msg_type: MsgType
  sent_at: number
  status: 'sent' | 'delivered'
}

export interface GroupMemberInfo {
  user_id: string
  joined_at: number
}

export interface GroupInfo {
  id: string
  creator_id: string
  title: string
  max_members: number
  created_at: number
  members: GroupMemberInfo[]
}

export interface GroupListResponse {
  groups: GroupInfo[]
}

export interface SendGroupMessageRequest {
  id: string
  payload_hex: string
  sent_at: number
}

export interface GroupMessageListResponse {
  messages: ServerEnvelope[]
}

export interface Friend {
  user_id: string
  pubkey_hex: string
  dh_shared_hex: string
  nickname: string | null
  blocked_at: number | null
}

export interface FriendInfo {
  user_id: string
  pubkey_hex: string
  created_at: number
}

export interface FriendListResponse {
  friends: FriendInfo[]
}

// QR payload shared when adding a friend in-person
export interface QrPayload {
  user_id: string
  pubkey_hex: string
  relay_address: string | null
  nickname: string | null
}
