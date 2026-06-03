'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Send, X, Users } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { ackGroupMessage, getGroupMessages, sendGroupMessage } from '@/lib/relay'
import { decodePayload, encodePayload } from '@/lib/crypto'
import { db } from '@/lib/db'
import { MessageBubble } from '@/components/MessageBubble'

interface GroupConversationPageProps {
  groupId?: string | null
  embedded?: boolean
}

export default function GroupConversationPage({ groupId: groupIdProp, embedded = false }: GroupConversationPageProps = {}) {
  const searchParams = useSearchParams()
  const groupId = groupIdProp ?? searchParams.get('group')
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const token = useAppStore((s) => s.token)
  const group = useAppStore((s) => (groupId ? s.groups[groupId] : undefined))
  const groupMessagesByGroup = useAppStore((s) => s.groupMessagesByGroup)
  const addGroupMessage = useAppStore((s) => s.addGroupMessage)
  const clearGroupUnread = useAppStore((s) => s.clearGroupUnread)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [friendNames, setFriendNames] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  const messages = useMemo(
    () => (groupId ? (groupMessagesByGroup[groupId] ?? []) : []),
    [groupId, groupMessagesByGroup],
  )

  useEffect(() => {
    if (!groupId) return
    clearGroupUnread(groupId)
  }, [clearGroupUnread, groupId])

  useEffect(() => {
    if (!group) return
    Promise.all(group.members.map((m) => db.friends.get(m.userId))).then((friends) => {
      const names: Record<string, string> = {}
      for (const friend of friends) {
        if (friend?.nickname) names[friend.userId] = friend.nickname
      }
      setFriendNames(names)
    })
  }, [group])

  useEffect(() => {
    if (!bootstrapped || !token || !userId || !groupId) return
    getGroupMessages(token, groupId).then(async ({ messages: pending }) => {
      for (const env of pending) {
        if (env.type !== 'group_message') continue
        addGroupMessage(groupId, {
          id: env.id,
          groupId,
          senderId: env.sender_id,
          content: decodePayload(env.payload_hex),
          sentAt: env.sent_at,
          isOwn: env.sender_id === userId,
          status: 'delivered',
        })
        await ackGroupMessage(token, groupId, env.id).catch(() => {})
      }
    }).catch(console.error)
  }, [addGroupMessage, bootstrapped, groupId, token, userId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !token || !userId || !groupId) return
    setSending(true)
    const id = crypto.randomUUID()
    const sentAt = Math.floor(Date.now() / 1000)
    addGroupMessage(groupId, {
      id,
      groupId,
      senderId: userId,
      content: text,
      sentAt,
      isOwn: true,
      status: 'sent',
    })
    setInput('')
    try {
      await sendGroupMessage(token, groupId, {
        id,
        payload_hex: encodePayload(text),
        sent_at: sentAt,
      })
    } catch (err) {
      console.error('[group send]', err)
    } finally {
      setSending(false)
    }
  }

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? <span className="text-red-500">Error: {bootstrapError}</span> : <span>Connecting...</span>}
      </div>
    )
  }

  if (!groupId) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Missing group id.</div>
  }

  const railOffset = embedded ? '' : 'md:ml-32 landscape:ml-32'
  const mobileComposerOffset = embedded
    ? ''
    : 'fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 md:static md:max-w-none md:translate-x-0 landscape:static landscape:max-w-none landscape:translate-x-0'
  const messageBottomPadding = embedded ? '' : 'pb-24 md:pb-4 landscape:pb-4'
  const title = group?.title || 'Group'
  const memberText = group ? `${group.members.length}/${group.maxMembers}` : ''

  function displayName(senderId: string): string {
    if (senderId === userId) return 'You'
    return friendNames[senderId] ?? `${senderId.slice(0, 8)}...`
  }

  return (
    <>
      <header className={`flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur ${railOffset}`}>
        <Link href="/chats" className="text-zinc-500 hover:text-zinc-800">
          {embedded ? <X size={20} /> : <ArrowLeft size={20} />}
        </Link>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Users size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{title}</p>
          <p className="text-xs text-zinc-400">{memberText} joined</p>
        </div>
      </header>

      <main className={`flex flex-1 flex-col gap-2 overflow-y-auto p-4 ${messageBottomPadding} ${railOffset}`}>
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            content={m.content}
            sentAt={m.sentAt}
            isOwn={m.isOwn}
            status={m.status}
            senderName={displayName(m.senderId)}
          />
        ))}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={handleSend}
        className={`flex items-end gap-2 border-t border-zinc-200 bg-white p-4 ${mobileComposerOffset} ${railOffset}`}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) }
          }}
          placeholder="Message the group..."
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-opacity disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </>
  )
}
