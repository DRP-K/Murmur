import Dexie, { type EntityTable } from 'dexie'

export interface Identity {
  userId: string
  pubkeyHex: string
  privkeyHex: string
  displayName: string | null
}

// Friends are stored locally because their pubkey is needed for ECDH and
// is not retrievable from the relay without a dedicated endpoint.
export interface LocalFriend {
  userId: string
  pubkeyHex: string
  dhSharedHex: string
  nickname: string | null
  blockedAt: number | null
}

// Anon thread ephemeral keys must survive page reloads.
export interface AnonThread {
  id: string           // thread_id = hex(SHA256(postId + ephPub)[0..16])
  postId: string
  postSnippet: string  // first ~60 chars of post content for chat list display
  ephemeralPrivHex: string  // empty string on the author's side
  ephemeralPubHex: string   // empty string on the author's side
  // The other party's relay user_id: initiator stores author_id, author stores sender_id.
  peerId: string
  isInitiator: 1 | 0
  status: 'open' | 'revealed' | 'closed'
  createdAt: number
}

// Persisted DM — survives page refresh.
export interface StoredMessage {
  id: string
  convId: string   // indexed for per-conversation queries
  content: string
  sentAt: number
  isOwn: boolean
  status: 'sent' | 'delivered'
}

// Persisted post — mirrors Post in types.ts.
export interface StoredPost {
  id: string
  author_id: string
  content: string
  timestamp: number
  expires_at: number | null
  is_own: boolean
}

// Persisted conversation summary — mirrors ConversationMeta in the Zustand store.
export interface StoredConversation {
  conversationId: string
  friendId: string
  friendName: string | null
  lastMessage: string
  lastAt: number
  unread: number
}

class MurmurDatabase extends Dexie {
  identity!: EntityTable<Identity, 'userId'>
  friends!: EntityTable<LocalFriend, 'userId'>
  anonThreads!: EntityTable<AnonThread, 'id'>
  messages!: EntityTable<StoredMessage, 'id'>
  conversations!: EntityTable<StoredConversation, 'conversationId'>
  posts!: EntityTable<StoredPost, 'id'>

  constructor() {
    super('murmur')
    this.version(1).stores({
      identity: 'userId',
      friends: 'userId, blockedAt',
      anonThreads: 'id, postId, status, createdAt',
    })
    this.version(2).stores({
      anonThreads: 'id, postId, peerId, status, createdAt',
    })
    this.version(3).stores({
      messages: 'id, convId, sentAt',
      conversations: 'conversationId',
    })
    this.version(4).stores({
      posts: 'id, timestamp',
    })
  }
}

export const db = new MurmurDatabase()
