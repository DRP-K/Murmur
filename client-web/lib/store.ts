import { create } from 'zustand'
import { auth as relayAuth } from './relay'
import { getIdentity } from './identity'
import { db } from './db'
import type { GroupInfo, Post } from './types'

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

export interface LocalGroupMember {
  userId: string
  joinedAt: number
}

export interface LocalGroup {
  id: string
  creatorId: string
  title: string
  maxMembers: number
  createdAt: number
  members: LocalGroupMember[]
  lastMessage: string
  lastAt: number
  unread: number
}

export interface LocalGroupMessage {
  id: string
  groupId: string
  senderId: string
  content: string
  sentAt: number
  isOwn: boolean
  status: 'sent' | 'delivered'
}

// convId = sort([a, b]).join('-'): 32-char hex + '-' + 32-char hex.
function friendIdFromConvId(convId: string, myUserId: string | null): string {
  const a = convId.slice(0, 32)
  const b = convId.slice(33)
  return myUserId && a === myUserId ? b : a
}

function mergePost(existing: Post, incoming: Post): Post {
  const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])]))
  return {
    ...existing,
    ...incoming,
    is_own: existing.is_own || incoming.is_own,
    tags: mergedTags,
    image_url: incoming.image_url ?? existing.image_url,
    attachment_url: incoming.attachment_url ?? existing.attachment_url,
    attachment_type: incoming.attachment_type ?? existing.attachment_type,
    rally_group_id: incoming.rally_group_id ?? existing.rally_group_id,
    rally_max_members: incoming.rally_max_members ?? existing.rally_max_members,
  }
}

function postsMatch(a: Post, b: Post): boolean {
  const tagsMatch =
    (a.tags ?? []).length === (b.tags ?? []).length &&
    (a.tags ?? []).every((tag) => (b.tags ?? []).includes(tag))
  return (
    a.id === b.id &&
    a.author_id === b.author_id &&
    a.content === b.content &&
    a.timestamp === b.timestamp &&
    a.is_own === b.is_own &&
    tagsMatch &&
    a.image_url === b.image_url &&
    a.attachment_url === b.attachment_url &&
    a.attachment_type === b.attachment_type &&
    a.rally_group_id === b.rally_group_id &&
    a.rally_max_members === b.rally_max_members
  )
}

function groupFromInfo(info: GroupInfo, existing?: LocalGroup): LocalGroup {
  return {
    id: info.id,
    creatorId: info.creator_id,
    title: info.title,
    maxMembers: info.max_members,
    createdAt: info.created_at,
    members: info.members.map((m) => ({ userId: m.user_id, joinedAt: m.joined_at })),
    lastMessage: existing?.lastMessage ?? '',
    lastAt: existing?.lastAt ?? info.created_at,
    unread: existing?.unread ?? 0,
  }
}

export interface FriendSetupEntry {
  friendId: string
  nickname: string | null
  metAtEvent: string | null
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
  groups: Record<string, LocalGroup>
  groupMessagesByGroup: Record<string, LocalGroupMessage[]>
  pendingFriendSetups: FriendSetupEntry[]
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
  upsertGroup: (group: GroupInfo | LocalGroup) => void
  upsertGroups: (groups: GroupInfo[]) => void
  addGroupMessage: (groupId: string, msg: LocalGroupMessage) => void
  clearGroupUnread: (groupId: string) => void
  pushFriendSetup: (entry: FriendSetupEntry) => void
  popFriendSetup: () => void
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
  groups: {},
  groupMessagesByGroup: {},
  pendingFriendSetups: [],

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
    const [storedMsgs, storedConvs, storedPosts, storedGroups, storedMembers, storedGroupMessages] = await Promise.all([
      db.messages.toArray(),
      db.conversations.toArray(),
      db.posts.orderBy('timestamp').reverse().toArray(),
      db.groups.toArray(),
      db.groupMembers.toArray(),
      db.groupMessages.toArray(),
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

    const groupMessagesByGroup: Record<string, LocalGroupMessage[]> = {}
    for (const msg of storedGroupMessages) {
      ;(groupMessagesByGroup[msg.groupId] ??= []).push(msg)
    }
    for (const arr of Object.values(groupMessagesByGroup)) {
      arr.sort((a, b) => a.sentAt - b.sentAt)
    }

    const membersByGroup = new Map<string, LocalGroupMember[]>()
    for (const member of storedMembers) {
      const arr = membersByGroup.get(member.groupId) ?? []
      arr.push({ userId: member.userId, joinedAt: member.joinedAt })
      membersByGroup.set(member.groupId, arr)
    }
    const groups: Record<string, LocalGroup> = {}
    for (const group of storedGroups) {
      const messages = groupMessagesByGroup[group.id] ?? []
      const latest = messages[messages.length - 1]
      groups[group.id] = {
        id: group.id,
        creatorId: group.creatorId,
        title: group.title,
        maxMembers: group.maxMembers,
        createdAt: group.createdAt,
        members: membersByGroup.get(group.id) ?? [],
        lastMessage: latest?.content ?? '',
        lastAt: latest?.sentAt ?? group.createdAt,
        unread: 0,
      }
    }

    const posts = storedPosts.map((p) => ({ ...p, tags: p.tags ?? [] }))
    set({ messagesByConv, conversations, posts, groups, groupMessagesByGroup })
  },

  addPosts: (incoming) => {
    const changedPosts: Post[] = []
    set((state) => {
      const incomingById = new Map(incoming.map((post) => [post.id, post]))
      const existingIds = new Set(state.posts.map((p) => p.id))
      const fresh = incoming.filter((p) => !existingIds.has(p.id))
      let changed = fresh.length > 0

      const mergedExisting = state.posts.map((post) => {
        const incomingPost = incomingById.get(post.id)
        if (!incomingPost) return post

        const merged = mergePost(post, incomingPost)
        if (!postsMatch(merged, post)) {
          changed = true
          changedPosts.push(merged)
          return merged
        }

        return post
      })

      if (!changed) return state

      changedPosts.push(...fresh)
      return { posts: [...fresh.reverse(), ...mergedExisting] }
    })
    for (const post of changedPosts) {
      db.posts.put(post).catch(console.error)
    }
  },

  addPost: (post) => {
    let changedPost: Post | null = null
    set((state) => {
      const existing = state.posts.find((p) => p.id === post.id)
      if (existing) {
        const merged = mergePost(existing, post)
        if (postsMatch(merged, existing)) {
          return state
        }

        changedPost = merged
        return { posts: state.posts.map((p) => (p.id === post.id ? merged : p)) }
      }

      changedPost = post
      return { posts: [post, ...state.posts] }
    })
    if (changedPost) db.posts.put(changedPost).catch(console.error)
  },

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

  upsertGroup: (group) => {
    const incoming = 'creator_id' in group ? groupFromInfo(group, get().groups[group.id]) : group
    set((state) => ({
      groups: {
        ...state.groups,
        [incoming.id]: incoming,
      },
    }))
    const saved = get().groups[incoming.id]
    if (!saved) return
    db.groups.put({
      id: saved.id,
      creatorId: saved.creatorId,
      title: saved.title,
      maxMembers: saved.maxMembers,
      createdAt: saved.createdAt,
    }).catch(console.error)
    for (const member of saved.members) {
      db.groupMembers.put({
        id: `${saved.id}:${member.userId}`,
        groupId: saved.id,
        userId: member.userId,
        joinedAt: member.joinedAt,
      }).catch(console.error)
    }
  },

  upsertGroups: (incoming) => {
    set((state) => {
      const groups = { ...state.groups }
      for (const group of incoming) {
        groups[group.id] = groupFromInfo(group, groups[group.id])
      }
      return { groups }
    })
    for (const group of incoming) {
      const saved = get().groups[group.id]
      if (!saved) continue
      db.groups.put({
        id: saved.id,
        creatorId: saved.creatorId,
        title: saved.title,
        maxMembers: saved.maxMembers,
        createdAt: saved.createdAt,
      }).catch(console.error)
      for (const member of saved.members) {
        db.groupMembers.put({
          id: `${saved.id}:${member.userId}`,
          groupId: saved.id,
          userId: member.userId,
          joinedAt: member.joinedAt,
        }).catch(console.error)
      }
    }
  },

  addGroupMessage: (groupId, msg) => {
    set((state) => {
      const existing = state.groupMessagesByGroup[groupId] ?? []
      if (existing.some((m) => m.id === msg.id)) return state
      const group = state.groups[groupId]
      return {
        groupMessagesByGroup: {
          ...state.groupMessagesByGroup,
          [groupId]: [...existing, msg].sort((a, b) => a.sentAt - b.sentAt),
        },
        groups: group
          ? {
              ...state.groups,
              [groupId]: {
                ...group,
                lastMessage: msg.content,
                lastAt: msg.sentAt,
                unread: msg.isOwn ? group.unread : group.unread + 1,
              },
            }
          : state.groups,
      }
    })
    db.groupMessages.put(msg).catch(console.error)
  },

  clearGroupUnread: (groupId) => {
    set((state) => {
      const group = state.groups[groupId]
      if (!group || group.unread === 0) return state
      return {
        groups: {
          ...state.groups,
          [groupId]: { ...group, unread: 0 },
        },
      }
    })
  },

  pushFriendSetup: (entry) =>
    set((state) => ({ pendingFriendSetups: [...state.pendingFriendSetups, entry] })),

  popFriendSetup: () =>
    set((state) => ({ pendingFriendSetups: state.pendingFriendSetups.slice(1) })),
}))
