import { create } from 'zustand'
import { auth as relayAuth } from './relay'
import { getIdentity } from './identity'
import { db } from './db'
import type { Post } from './types'

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

export interface LocalMessage {
  id: string
  content: string
  sentAt: number
  isOwn: boolean
  status: 'sent' | 'delivered'
}

export interface ConversationMeta {
  conversationId: string
  friendId: string
  friendName: string | null
  lastMessage: string
  lastAt: number
  unread: number
}

// convId = sort([a, b]).join('-'): 32-char hex + '-' + 32-char hex.
function friendIdFromConvId(convId: string, myUserId: string | null): string {
  const a = convId.slice(0, 32)
  const b = convId.slice(33)
  return myUserId && a === myUserId ? b : a
}

interface AppState {
  userId: string | null
  pubkeyHex: string | null
  token: string | null
  wsStatus: WsStatus
  bootstrapped: boolean
  bootstrapError: string | null
  posts: Post[]
  messagesByConv: Record<string, LocalMessage[]>
  conversations: Record<string, ConversationMeta>
}

interface AppActions {
  setSession: (userId: string, pubkeyHex: string, token: string) => void
  setToken: (token: string) => void
  setWsStatus: (wsStatus: WsStatus) => void
  setBootstrapped: (ok: boolean, error?: string) => void
  authenticate: () => Promise<string>
  loadFromDexie: () => Promise<void>
  addPosts: (posts: Post[]) => void
  addPost: (post: Post) => void
  addMessage: (convId: string, msg: LocalMessage) => void
  addMessages: (convId: string, msgs: LocalMessage[]) => void
  updateMessageStatus: (msgId: string, status: 'sent' | 'delivered') => void
  upsertConversation: (convId: string, update: {
    friendId: string
    lastMessage?: string
    lastAt?: number
    unread?: number
    friendName?: string
  }) => void
  clearUnread: (convId: string) => void
}

export type AppStore = AppState & AppActions

export const useAppStore = create<AppStore>((set, get) => ({
  userId: null,
  pubkeyHex: null,
  token: null,
  wsStatus: 'idle',
  bootstrapped: false,
  bootstrapError: null,
  posts: [],
  messagesByConv: {},
  conversations: {},

  setSession: (userId, pubkeyHex, token) => set({ userId, pubkeyHex, token }),
  setToken: (token) => set({ token }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setBootstrapped: (ok, error) =>
    set({ bootstrapped: ok, bootstrapError: error ?? null }),

  authenticate: async () => {
    const identity = await getIdentity()
    if (!identity) throw new Error('no identity — call initIdentity first')
    const token = await relayAuth(identity.userId, identity.privkeyHex)
    set({ token, userId: identity.userId, pubkeyHex: identity.pubkeyHex })
    return token
  },

  loadFromDexie: async () => {
    const [storedMsgs, storedConvs] = await Promise.all([
      db.messages.toArray(),
      db.conversations.toArray(),
    ])

    const messagesByConv: Record<string, LocalMessage[]> = {}
    for (const { convId, ...msg } of storedMsgs) {
      ;(messagesByConv[convId] ??= []).push(msg)
    }
    for (const arr of Object.values(messagesByConv)) {
      arr.sort((a, b) => a.sentAt - b.sentAt)
    }

    const conversations: Record<string, ConversationMeta> = Object.fromEntries(
      storedConvs.map((c) => [c.conversationId, c]),
    )

    set({ messagesByConv, conversations })
  },

  addPosts: (incoming) =>
    set((state) => {
      const existing = new Set(state.posts.map((p) => p.id))
      const fresh = incoming.filter((p) => !existing.has(p.id))
      if (fresh.length === 0) return state
      return { posts: [...fresh.reverse(), ...state.posts] }
    }),

  addPost: (post) =>
    set((state) => {
      if (state.posts.some((p) => p.id === post.id)) return state
      return { posts: [post, ...state.posts] }
    }),

  addMessage: (convId, msg) => {
    set((state) => {
      const existing = state.messagesByConv[convId] ?? []
      if (existing.some((m) => m.id === msg.id)) return state

      const existingConv = state.conversations[convId]
      const friendId = friendIdFromConvId(convId, state.userId)
      const isNewer = !existingConv || msg.sentAt >= existingConv.lastAt

      return {
        messagesByConv: {
          ...state.messagesByConv,
          [convId]: [...existing, msg].sort((a, b) => a.sentAt - b.sentAt),
        },
        conversations: {
          ...state.conversations,
          [convId]: {
            conversationId: convId,
            friendId,
            friendName: existingConv?.friendName ?? null,
            lastMessage: isNewer ? msg.content : (existingConv?.lastMessage ?? msg.content),
            lastAt: isNewer ? msg.sentAt : (existingConv?.lastAt ?? msg.sentAt),
            unread: msg.isOwn
              ? (existingConv?.unread ?? 0)
              : (existingConv?.unread ?? 0) + 1,
          },
        },
      }
    })
    // Persist to Dexie after the synchronous Zustand update.
    db.messages.put({ ...msg, convId }).catch(console.error)
    const conv = get().conversations[convId]
    if (conv) db.conversations.put(conv).catch(console.error)
  },

  addMessages: (convId, msgs) => {
    set((state) => {
      const existing = state.messagesByConv[convId] ?? []
      const existingIds = new Set(existing.map((m) => m.id))
      const fresh = msgs.filter((m) => !existingIds.has(m.id))
      if (fresh.length === 0) return state

      const latest = fresh.reduce((a, b) => (a.sentAt > b.sentAt ? a : b))
      const existingConv = state.conversations[convId]
      const friendId = friendIdFromConvId(convId, state.userId)
      const isNewer = !existingConv || latest.sentAt >= existingConv.lastAt
      const newUnread = fresh.filter((m) => !m.isOwn).length

      return {
        messagesByConv: {
          ...state.messagesByConv,
          [convId]: [...existing, ...fresh].sort((a, b) => a.sentAt - b.sentAt),
        },
        conversations: {
          ...state.conversations,
          [convId]: {
            conversationId: convId,
            friendId,
            friendName: existingConv?.friendName ?? null,
            lastMessage: isNewer ? latest.content : (existingConv?.lastMessage ?? latest.content),
            lastAt: isNewer ? latest.sentAt : (existingConv?.lastAt ?? latest.sentAt),
            unread: (existingConv?.unread ?? 0) + newUnread,
          },
        },
      }
    })
    for (const msg of msgs) {
      db.messages.put({ ...msg, convId }).catch(console.error)
    }
    const conv = get().conversations[convId]
    if (conv) db.conversations.put(conv).catch(console.error)
  },

  updateMessageStatus: (msgId, status) => {
    set((state) => {
      const updated: Record<string, LocalMessage[]> = {}
      let changed = false
      for (const [convId, msgs] of Object.entries(state.messagesByConv)) {
        const newMsgs = msgs.map((m) => (m.id === msgId ? { ...m, status } : m))
        if (newMsgs !== msgs) changed = true
        updated[convId] = newMsgs
      }
      if (!changed) return state
      return { messagesByConv: updated }
    })
    // Update status in Dexie — we don't know the convId here, so use update by id.
    db.messages.update(msgId, { status }).catch(console.error)
  },

  upsertConversation: (convId, update) => {
    set((state) => {
      const existing = state.conversations[convId]
      return {
        conversations: {
          ...state.conversations,
          [convId]: {
            conversationId: convId,
            friendId: update.friendId,
            friendName: update.friendName ?? existing?.friendName ?? null,
            lastMessage: update.lastMessage ?? existing?.lastMessage ?? '',
            lastAt: update.lastAt ?? existing?.lastAt ?? 0,
            unread: update.unread ?? existing?.unread ?? 0,
          },
        },
      }
    })
    const conv = get().conversations[convId]
    if (conv) db.conversations.put(conv).catch(console.error)
  },

  clearUnread: (convId) => {
    set((state) => {
      const existing = state.conversations[convId]
      if (!existing || existing.unread === 0) return state
      return {
        conversations: {
          ...state.conversations,
          [convId]: { ...existing, unread: 0 },
        },
      }
    })
    const conv = get().conversations[convId]
    if (conv) db.conversations.put(conv).catch(console.error)
  },
}))
