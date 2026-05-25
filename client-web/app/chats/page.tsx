'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ensureAnonThread } from '@/hooks/useAnonSink'
import { processFriendAdded } from '@/hooks/useFriendSink'
import { useAppStore, type LocalMessage } from '@/lib/store'
import { getMessages, ackMessage } from '@/lib/relay'
import { decodePayload as decode } from '@/lib/crypto'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { ChatRow } from '@/components/ChatRow'
import { TabBar } from '@/components/TabBar'
import type { ServerEnvelope } from '@/lib/types'

interface ConversationSummary {
  conversationId: string
  friendId: string
  friendName: string | null
  lastMessage: string
  lastAt: number
  unread: number
}

interface FriendRow {
  conversationId: string
  friendId: string
  friendName: string | null
}

interface AnonSummary {
  threadId: string
  postSnippet: string
  lastAt: number
}

function makeConversationId(a: string, b: string): string {
  return [a, b].sort().join('-')
}

export default function ChatsPage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const token = useAppStore((s) => s.token)
  const addMessage = useAppStore((s) => s.addMessage)
  const router = useRouter()

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [anonThreads, setAnonThreads] = useState<AnonSummary[]>([])

  async function loadFriends(myId: string) {
    const all = await db.friends
      .filter((f) => f.blockedAt === null)
      .toArray()
    console.log('[chats] Dexie friends loaded:', all.length, all.map(f => f.userId.slice(0,8)))
    return all
  }

  async function loadMessages(tok: string, myId: string) {
    console.log('[chats] loadMessages: fetching pending messages')
    const { messages } = await getMessages(tok)
    console.log('[chats] loadMessages: got', messages.length, 'envelopes')

    const map = new Map<string, ConversationSummary>()
    for (const env of messages) {
      if (env.type !== 'message') continue

      // Handle anon messages.
      if (env.msg_type === 'anon') {
        ensureAnonThread(
          env as ServerEnvelope & { type: 'message'; msg_type: 'anon' },
        ).catch(console.error)
        continue
      }

      // Handle friend_added: store friend in local Dexie.
      if (env.msg_type === 'friend_added') {
        console.log('[chats] loadMessages: processing friend_added from', env.sender_id.slice(0,8), 'payload:', decode(env.payload_hex))
        processFriendAdded(
          env as ServerEnvelope & { type: 'message'; msg_type: 'friend_added' },
        ).catch(console.error)
        continue
      }

      // Only DMs from here on.
      if (env.msg_type !== 'dm') continue

      const convId = makeConversationId(myId, env.sender_id)
      const content = decode(env.payload_hex)

      // Store in global message store so DM page can read it.
      const msg: LocalMessage = {
        id: env.id,
        content,
        sentAt: env.sent_at,
        isOwn: env.sender_id === myId,
        status: 'delivered',
      }
      addMessage(convId, msg)
      ackMessage(tok, env.id).catch(() => {})

      const existing = map.get(convId)
      if (!existing || env.sent_at > existing.lastAt) {
        const friend = await db.friends.get(env.sender_id)
        map.set(convId, {
          conversationId: convId,
          friendId: env.sender_id,
          friendName: friend?.nickname ?? null,
          lastMessage: content,
          lastAt: env.sent_at,
          unread: (existing?.unread ?? 0) + 1,
        })
      } else {
        map.set(convId, { ...existing, unread: existing.unread + 1 })
      }
    }

    const convList = [...map.values()].sort((a, b) => b.lastAt - a.lastAt)
    console.log('[chats] loadMessages:', convList.length, 'conversations built')
    setConversations(convList)

    // Friends without conversations: show below.
    const allFriends = await loadFriends(myId)
    const convFriendIds = new Set(convList.map(c => c.friendId))
    const friendsOnly = allFriends
      .filter(f => !convFriendIds.has(f.userId))
      .map(f => ({
        conversationId: makeConversationId(myId, f.userId),
        friendId: f.userId,
        friendName: f.nickname,
      }))
    console.log('[chats] loadMessages:', friendsOnly.length, 'friends without messages')
    setFriends(friendsOnly)
  }

  async function loadAnonThreads() {
    const threads = await db.anonThreads
      .filter((t) => t.status !== 'closed')
      .toArray()
    setAnonThreads(
      threads
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => ({ threadId: t.id, postSnippet: t.postSnippet, lastAt: t.createdAt })),
    )
  }

  // Refresh friends list (call after friend_added is processed).
  async function refreshFriends(myId: string) {
    const allFriends = await loadFriends(myId)
    const convFriendIds = new Set(conversations.map(c => c.friendId))
    const friendsOnly = allFriends
      .filter(f => !convFriendIds.has(f.userId))
      .map(f => ({
        conversationId: makeConversationId(myId, f.userId),
        friendId: f.userId,
        friendName: f.nickname,
      }))
    setFriends(friendsOnly)
  }

  useEffect(() => {
    if (!bootstrapped || !token || !userId) return
    loadMessages(token, userId).catch(console.error)
    loadAnonThreads().catch(console.error)
  }, [bootstrapped, token, userId])

  // Update list when new messages arrive over WS.
  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'message') return
      const myId = useAppStore.getState().userId
      if (!myId) return

      // DMs: update conversation list + global store.
      if (env.msg_type === 'dm') {
        const content = decode(env.payload_hex)
        const convId = makeConversationId(myId, env.sender_id)
        addMessage(convId, {
          id: env.id, content, sentAt: env.sent_at,
          isOwn: env.sender_id === myId, status: 'delivered',
        })
        setConversations((prev) => {
          const existing = prev.find((c) => c.conversationId === convId)
          const updated: ConversationSummary = {
            conversationId: convId,
            friendId: env.sender_id,
            friendName: existing?.friendName ?? null,
            lastMessage: content,
            lastAt: env.sent_at,
            unread: (existing?.unread ?? 0) + 1,
          }
          const rest = prev.filter((c) => c.conversationId !== convId)
          return [updated, ...rest]
        })
        // Remove this friend from the friends-only list.
        setFriends((prev) => prev.filter(f => f.friendId !== env.sender_id))
      }

      // Anon: refresh the thread list.
      if (env.msg_type === 'anon') {
        loadAnonThreads().catch(console.error)
      }

      // Friend added: refresh friends list.
      if (env.msg_type === 'friend_added') {
        console.log('[chats] WS: friend_added received, refreshing friends')
        // Wait a tick for Dexie write to settle.
        setTimeout(() => refreshFriends(myId), 200)
      }
    })
  }, [])

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? <span className="text-red-500">{bootstrapError}</span> : <span>Connecting…</span>}
      </div>
    )
  }

  const empty = conversations.length === 0 && friends.length === 0 && anonThreads.length === 0

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Chats</h1>
      </header>

      <main className="flex flex-1 flex-col gap-2 p-4">
        {empty ? (
          <p className="pt-16 text-center text-sm text-zinc-400">No messages or friends yet.</p>
        ) : (
          <>
            {conversations.map((c) => (
              <ChatRow
                key={c.conversationId}
                name={c.friendName ?? c.friendId.slice(0, 8) + '…'}
                preview={c.lastMessage}
                timestamp={c.lastAt}
                unread={c.unread}
                onClick={() => router.push(`/chats/${c.conversationId}`)}
              />
            ))}

            {friends.length > 0 && (
              <>
                <p className="mt-4 px-1 text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Friends
                </p>
                {friends.map((f) => (
                  <ChatRow
                    key={f.friendId}
                    name={f.friendName ?? f.friendId.slice(0, 8) + '…'}
                    preview="No messages yet — say hi!"
                    timestamp={0}
                    onClick={() => router.push(`/chats/${f.conversationId}`)}
                  />
                ))}
              </>
            )}

            {anonThreads.length > 0 && (
              <>
                <p className="mt-4 px-1 text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Anonymous threads
                </p>
                {anonThreads.map((t) => (
                  <ChatRow
                    key={t.threadId}
                    name={`"${t.postSnippet.slice(0, 40)}"`}
                    preview="Anonymous thread"
                    timestamp={t.lastAt}
                    isAnon
                    onClick={() => router.push(`/chats/anon/${t.threadId}`)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </main>

      <TabBar />
    </>
  )
}
