'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ensureAnonThread } from '@/hooks/useAnonSink'
import { processFriendAdded } from '@/hooks/useFriendSink'
import { useAppStore, type ConversationMeta } from '@/lib/store'
import { getMessages, ackMessage } from '@/lib/relay'
import { decodePayload as decode } from '@/lib/crypto'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { ChatRow } from '@/components/ChatRow'
import { TabBar } from '@/components/TabBar'
import ConversationPage from './ConversationView'
import type { ServerEnvelope } from '@/lib/types'

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
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Loading…</div>}>
      <ChatsPageContent />
    </Suspense>
  )
}

function ChatsPageContent() {
  const searchParams = useSearchParams()
  if (searchParams.has('id')) return <ConversationPage />

  return <ChatListPage />
}

function ChatListPage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const token = useAppStore((s) => s.token)
  const addMessage = useAppStore((s) => s.addMessage)
  const upsertConversation = useAppStore((s) => s.upsertConversation)
  // Conversations survive tab navigation — sourced from Zustand.
  const conversationsMap = useAppStore((s) => s.conversations)
  const conversations = Object.values(conversationsMap).sort((a, b) => b.lastAt - a.lastAt)
  const router = useRouter()

  const [friends, setFriends] = useState<FriendRow[]>([])
  const [anonThreads, setAnonThreads] = useState<AnonSummary[]>([])

  const loadFriends = useCallback(async () => {
    return db.friends.filter((f) => f.blockedAt === null).toArray()
  }, [])

  // Fetch pending messages: ack DMs, enrich conversation names, handle side-types.
  const loadMessages = useCallback(async (tok: string, myId: string) => {
    const { messages } = await getMessages(tok)

    for (const env of messages) {
      if (env.type !== 'message') continue

      if (env.msg_type === 'anon') {
        ensureAnonThread(
          env as ServerEnvelope & { type: 'message'; msg_type: 'anon' },
        ).catch(console.error)
        continue
      }

      if (env.msg_type === 'friend_added') {
        processFriendAdded(
          env as ServerEnvelope & { type: 'message'; msg_type: 'friend_added' },
        ).catch(console.error)
        continue
      }

      if (env.msg_type !== 'dm') continue

      const convId = makeConversationId(myId, env.sender_id)
      const content = decode(env.payload_hex)

      addMessage(convId, {
        id: env.id,
        content,
        sentAt: env.sent_at,
        isOwn: env.sender_id === myId,
        status: 'delivered',
      })
      ackMessage(tok, env.id).catch(() => {})

      // Enrich with friendName from Dexie if available.
      const friend = await db.friends.get(env.sender_id)
      if (friend) {
        upsertConversation(convId, {
          friendId: env.sender_id,
          friendName: friend.nickname ?? undefined,
        })
      }
    }

    // Build friends-without-conversations list.
    const allFriends = await loadFriends()
    setFriends(
      allFriends.map((f) => ({
        conversationId: makeConversationId(myId, f.userId),
        friendId: f.userId,
        friendName: f.nickname,
      })),
    )
  }, [addMessage, loadFriends, upsertConversation])

  const loadAnonThreads = useCallback(async () => {
    const threads = await db.anonThreads
      .filter((t) => t.status !== 'closed')
      .toArray()
    setAnonThreads(
      threads
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => ({ threadId: t.id, postSnippet: t.postSnippet, lastAt: t.createdAt })),
    )
  }, [])

  const refreshFriends = useCallback(async (myId: string) => {
    const allFriends = await loadFriends()
    setFriends(
      allFriends.map((f) => ({
        conversationId: makeConversationId(myId, f.userId),
        friendId: f.userId,
        friendName: f.nickname,
      })),
    )
  }, [loadFriends])

  useEffect(() => {
    if (!bootstrapped || !token || !userId) return
    queueMicrotask(() => {
      loadMessages(token, userId).catch(console.error)
      loadAnonThreads().catch(console.error)
    })
  }, [bootstrapped, loadAnonThreads, loadMessages, token, userId])

  // WS: only handle side-effects that need Dexie refreshes.
  // DMs are handled globally by useMessageSink + the store's addMessage.
  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'message') return
      const myId = useAppStore.getState().userId
      if (!myId) return

      if (env.msg_type === 'anon') {
        loadAnonThreads().catch(console.error)
      }

      if (env.msg_type === 'friend_added') {
        // Wait a tick for Dexie write (useFriendSink) to settle.
        setTimeout(() => refreshFriends(myId), 200)
      }
    })
  }, [loadAnonThreads, refreshFriends])

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? <span className="text-red-500">{bootstrapError}</span> : <span>Connecting…</span>}
      </div>
    )
  }

  // Build a fresh nickname lookup from the Dexie-loaded friends list so that
  // conversation rows always reflect the latest nickname even if the Zustand
  // store has a stale value from before the user last edited it.
  const nickMap = new Map(friends.map((f) => [f.friendId, f.friendName]))

  function displayName(friendId: string, storedName: string | null): string {
    const nick = nickMap.get(friendId) ?? storedName
    return nick ?? friendId
  }

  // Friends who already have a conversation move out of the friends-only section.
  const conversationFriendIds = new Set(conversations.map((c) => c.friendId))
  const friendsOnly = friends.filter((f) => !conversationFriendIds.has(f.friendId))

  const empty = conversations.length === 0 && friendsOnly.length === 0 && anonThreads.length === 0

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
            {conversations.map((c: ConversationMeta) => (
              <ChatRow
                key={c.conversationId}
                name={displayName(c.friendId, c.friendName)}
                preview={c.lastMessage}
                timestamp={c.lastAt}
                unread={c.unread}
                onClick={() => router.push(`/chats?id=${encodeURIComponent(c.conversationId)}`)}
              />
            ))}

            {friendsOnly.length > 0 && (
              <>
                <p className="mt-4 px-1 text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Friends
                </p>
                {friendsOnly.map((f) => (
                  <ChatRow
                    key={f.friendId}
                    name={f.friendName ?? f.friendId}
                    preview="No messages yet — say hi!"
                    timestamp={0}
                    onClick={() => router.push(`/chats?id=${encodeURIComponent(f.conversationId)}`)}
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
                    onClick={() => router.push(`/anon?threadId=${encodeURIComponent(t.threadId)}`)}
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
