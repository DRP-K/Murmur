'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Users } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { ackGroupMessage, getGroupMessages, sendGroupMessage } from '@/lib/relay'
import { decodePayload, encodePayload } from '@/lib/crypto'
import { db } from '@/lib/db'
import { ChatComposer } from '@/components/ChatComposer'
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
  const router = useRouter()

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

  async function handleSend() {
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
    : 'sticky bottom-0 z-10 w-full max-w-md md:static md:max-w-none md:translate-x-0 landscape:static landscape:max-w-none landscape:translate-x-0'
  const title = group?.title || 'Group'
  const memberText = group ? `${group.members.length}/${group.maxMembers}` : ''

  function displayName(senderId: string): string {
    if (senderId === userId) return 'You'
    return friendNames[senderId] ?? `${senderId.slice(0, 8)}...`
  }

  return (
    <>
      <header className={`flex sticky top-0 z-10 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur ${railOffset}`}>
        {!embedded && (
          <button onClick={() => router.push('/chats')} className="text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Users size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{title}</p>
          <p className="text-xs text-zinc-400">{memberText} joined</p>
        </div>
      </header>

      <main className={`flex flex-1 flex-col gap-2 overflow-y-auto p-4 ${railOffset}`}>
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

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        sending={sending}
        placeholder="Message the group..."
        className={`${mobileComposerOffset} ${railOffset}`}
      />
    </>
  )
}
