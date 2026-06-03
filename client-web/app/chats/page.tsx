'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { ensureAnonThread } from '@/hooks/useAnonSink'
import { processFriendAdded } from '@/hooks/useFriendSink'
import { useAppStore, type ConversationMeta } from '@/lib/store'
import { getGroups, getMessages } from '@/lib/relay'
import { decodePayload as decode } from '@/lib/crypto'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { ChatRow } from '@/components/ChatRow'
import { TabBar } from '@/components/TabBar'
import ConversationPage from './ConversationView'
import GroupConversationPage from './GroupConversationView'
import type { ServerEnvelope } from '@/lib/types'

interface FriendRow {
  conversationId: string
  friendId: string
  friendName: string | null
  metAtEvent: string | null
}

interface AnonSummary {
  threadId: string
  postSnippet: string
  lastAt: number
}

function makeConversationId(a: string, b: string): string {
  return [a, b].sort().join('-')
}

function useSplitLayout() {
  const [split, setSplit] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px), (orientation: landscape)')
    const update = () => setSplit(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return split
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
  const selectedConversationId = searchParams.get('id')
  const selectedGroupId = searchParams.get('group')
  const split = useSplitLayout()

  if (split) {
    return (
      <>
        <div className="ml-32 grid h-dvh min-w-0 grid-cols-[minmax(320px,28vw)_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50">
            <ChatListPage pane selectedConversationId={selectedConversationId} selectedGroupId={selectedGroupId} />
          </aside>
          <section className="flex min-h-0 min-w-0 flex-col bg-zinc-50">
            {selectedGroupId ? (
              <GroupConversationPage groupId={selectedGroupId} embedded />
            ) : selectedConversationId ? (
              <ConversationPage conversationId={selectedConversationId} embedded />
            ) : (
              <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-zinc-400">
                Select a chat to start talking.
              </div>
            )}
          </section>
        </div>
        <TabBar sideOnly />
      </>
    )
  }

  if (selectedGroupId) return <GroupConversationPage groupId={selectedGroupId} />
  if (selectedConversationId) return <ConversationPage />

  return <ChatListPage />
}

interface ChatListPageProps {
  pane?: boolean
  selectedConversationId?: string | null
  selectedGroupId?: string | null
}

function ChatListPage({ pane = false, selectedConversationId = null, selectedGroupId = null }: ChatListPageProps = {}) {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const token = useAppStore((s) => s.token)
  const addMessage = useAppStore((s) => s.addMessage)
  const upsertConversation = useAppStore((s) => s.upsertConversation)
  const upsertGroups = useAppStore((s) => s.upsertGroups)
  // Conversations survive tab navigation — sourced from Zustand.
  const conversationsMap = useAppStore((s) => s.conversations)
  const conversations = Object.values(conversationsMap).sort((a, b) => b.lastAt - a.lastAt)
  const groupsMap = useAppStore((s) => s.groups)
  const groups = Object.values(groupsMap).sort((a, b) => b.lastAt - a.lastAt)
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
        await processFriendAdded(
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
        metAtEvent: f.metAtEvent,
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

  const loadGroups = useCallback(async (tok: string) => {
    const res = await getGroups(tok)
    upsertGroups(res.groups)
  }, [upsertGroups])

  const refreshFriends = useCallback(async (myId: string) => {
    const allFriends = await loadFriends()
    setFriends(
      allFriends.map((f) => ({
        conversationId: makeConversationId(myId, f.userId),
        friendId: f.userId,
        friendName: f.nickname,
        metAtEvent: f.metAtEvent,
      })),
    )
  }, [loadFriends])

  useEffect(() => {
    if (!bootstrapped || !token || !userId) return
    queueMicrotask(() => {
      loadMessages(token, userId).catch(console.error)
      loadAnonThreads().catch(console.error)
      loadGroups(token).catch(console.error)
    })
  }, [bootstrapped, loadAnonThreads, loadGroups, loadMessages, token, userId])

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
  const eventMap = new Map(friends.map((f) => [f.friendId, f.metAtEvent]))

  function displayName(friendId: string, storedName: string | null): string {
    const nick = nickMap.get(friendId) ?? storedName
    return nick ?? friendId
  }

  // Friends who already have a conversation move out of the friends-only section.
  const conversationFriendIds = new Set(conversations.map((c) => c.friendId))
  const friendsOnly = friends.filter((f) => !conversationFriendIds.has(f.friendId))

  const empty = conversations.length === 0 && friendsOnly.length === 0 && anonThreads.length === 0 && groups.length === 0

  return (
    <>
      <header className={`${pane ? '' : 'md:ml-32 landscape:ml-32'} sticky top-0 z-10 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur`}>
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-zinc-800">Chats</h1>
          <button
            onClick={() => router.push('/friends')}
            aria-label="Add friend"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
          >
            <Plus size={16} />
          </button>
        </div>
      </header>

      <main className={`${pane ? 'min-h-0 overflow-y-auto pb-4' : 'pb-16 md:ml-32 md:pb-4 landscape:ml-32 landscape:pb-4'} flex flex-1 flex-col gap-2 p-4`}>
        {empty ? (
          <p className="pt-16 text-center text-sm text-zinc-400">No messages or friends yet.</p>
        ) : (
          <>
            {groups.length > 0 && (
              <>
                <p className="px-1 text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Groups
                </p>
                {groups.map((g) => (
                  <ChatRow
                    key={g.id}
                    name={g.title || 'Group'}
                    preview={g.lastMessage || `${g.members.length}/${g.maxMembers} joined`}
                    timestamp={g.lastAt}
                    unread={g.unread}
                    active={selectedGroupId === g.id}
                    onClick={() => router.push(`/chats?group=${encodeURIComponent(g.id)}`)}
                  />
                ))}
              </>
            )}

            {conversations.map((c: ConversationMeta) => (
              <ChatRow
                key={c.conversationId}
                name={displayName(c.friendId, c.friendName)}
                metAtEvent={eventMap.get(c.friendId) ?? null}
                preview={c.lastMessage}
                timestamp={c.lastAt}
                unread={c.unread}
                active={selectedConversationId === c.conversationId}
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
                    metAtEvent={f.metAtEvent}
                    preview="No messages yet — say hi!"
                    timestamp={0}
                    active={selectedConversationId === f.conversationId}
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

      {!pane && <TabBar />}
    </>
  )
}
