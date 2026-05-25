import { create } from 'zustand'
import { auth as relayAuth } from './relay'
import { getIdentity } from './identity'
import type { Post } from './types'

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

// Client-side rendered message (DM or anon).
export interface LocalMessage {
  id: string
  content: string
  sentAt: number
  isOwn: boolean
  status: 'sent' | 'delivered'
}

interface AppState {
  userId: string | null
  pubkeyHex: string | null
  token: string | null
  wsStatus: WsStatus
  bootstrapped: boolean
  bootstrapError: string | null
  // Post feed — survives tab navigations (in-memory, lost on refresh).
  posts: Post[]
  // Messages by conversation ID — survives tab navigations.
  messagesByConv: Record<string, LocalMessage[]>
}

interface AppActions {
  setSession: (userId: string, pubkeyHex: string, token: string) => void
  setToken: (token: string) => void
  setWsStatus: (wsStatus: WsStatus) => void
  setBootstrapped: (ok: boolean, error?: string) => void
  authenticate: () => Promise<string>
  addPosts: (posts: Post[]) => void
  addPost: (post: Post) => void
  addMessage: (convId: string, msg: LocalMessage) => void
  addMessages: (convId: string, msgs: LocalMessage[]) => void
  updateMessageStatus: (msgId: string, status: 'sent' | 'delivered') => void
}

export type AppStore = AppState & AppActions

export const useAppStore = create<AppStore>((set) => ({
  userId: null,
  pubkeyHex: null,
  token: null,
  wsStatus: 'idle',
  bootstrapped: false,
  bootstrapError: null,
  posts: [],
  messagesByConv: {},

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

  addMessage: (convId, msg) =>
    set((state) => {
      const existing = state.messagesByConv[convId] ?? []
      if (existing.some((m) => m.id === msg.id)) return state
      return {
        messagesByConv: {
          ...state.messagesByConv,
          [convId]: [...existing, msg].sort((a, b) => a.sentAt - b.sentAt),
        },
      }
    }),

  addMessages: (convId, msgs) =>
    set((state) => {
      const existing = state.messagesByConv[convId] ?? []
      const existingIds = new Set(existing.map((m) => m.id))
      const fresh = msgs.filter((m) => !existingIds.has(m.id))
      if (fresh.length === 0) return state
      return {
        messagesByConv: {
          ...state.messagesByConv,
          [convId]: [...existing, ...fresh].sort((a, b) => a.sentAt - b.sentAt),
        },
      }
    }),

  updateMessageStatus: (msgId, status) =>
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
    }),
}))