'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Send } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { sendMessage, getMessages, ackMessage } from '@/lib/relay'
import { encodePayload, decodePayload } from '@/lib/crypto'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { MessageBubble } from '@/components/MessageBubble'
import type { ServerEnvelope } from '@/lib/types'

function extractFriendId(conversationId: string, myUserId: string): string {
  const a = conversationId.slice(0, 32)
  const b = conversationId.slice(33)
  return a === myUserId ? b : a
}

export default function ConversationPage() {
  const searchParams = useSearchParams()
  const conversationId = searchParams.get('id')
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const token = useAppStore((s) => s.token)
  const messagesByConv = useAppStore((s) => s.messagesByConv)
  const addMessage = useAppStore((s) => s.addMessage)
  const updateMessageStatus = useAppStore((s) => s.updateMessageStatus)
  const clearUnread = useAppStore((s) => s.clearUnread)
  const router = useRouter()

  const messages = useMemo(
    () => (conversationId ? (messagesByConv[conversationId] ?? []) : []),
    [conversationId, messagesByConv],
  )
  const [friendName, setFriendName] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const friendId = userId && conversationId ? extractFriendId(conversationId, userId) : null

  useEffect(() => {
    if (!friendId) return
    db.friends.get(friendId).then((f) => setFriendName(f?.nickname ?? null))
  }, [friendId])

  // Clear unread badge when the conversation is opened.
  useEffect(() => {
    if (!conversationId) return
    clearUnread(conversationId)
  }, [conversationId, clearUnread])

  // On mount: fetch any pending messages for this conversation from the server,
  // add them to the store (dedup), and ack them so they clear the queue.
  useEffect(() => {
    if (!bootstrapped || !token || !userId || !conversationId) return
    getMessages(token).then(({ messages: pending }) => {
      for (const env of pending) {
        if (env.type !== 'message' || env.msg_type !== 'dm') continue
        const convId = [userId, env.sender_id].sort().join('-')
        if (convId !== conversationId) continue
        addMessage(convId, {
          id: env.id,
          content: decodePayload(env.payload_hex),
          sentAt: env.sent_at,
          isOwn: env.sender_id === userId,
          status: 'delivered',
        })
        ackMessage(token, env.id).catch(() => {})
      }
    }).catch(console.error)
  }, [bootstrapped, token, userId, conversationId, addMessage])

  // WS: ack DMs that arrive while the conversation is open (useMessageSink
  // already adds them to the store); update status for sender's own messages.
  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type === 'delivered_ack') {
        updateMessageStatus(env.id, 'delivered')
        return
      }
      if (env.type === 'message' && env.msg_type === 'dm') {
        const myId = useAppStore.getState().userId
        if (!myId) return
        const convId = [myId, env.sender_id].sort().join('-')
        if (convId !== conversationId) return
        const tok = useAppStore.getState().token
        if (tok) ackMessage(tok, env.id).catch(() => {})
      }
    })
  }, [conversationId, updateMessageStatus])

  // Scroll to bottom when messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !token || !friendId || !userId || !conversationId) return

    setSending(true)
    const id = crypto.randomUUID()
    const sentAt = Math.floor(Date.now() / 1000)

    // Optimistic insert into global store.
    addMessage(conversationId, { id, content: text, sentAt, isOwn: true, status: 'sent' })
    setInput('')

    try {
      await sendMessage(token, {
        id,
        recipient_id: friendId,
        payload_hex: encodePayload(text),
        nonce_hex: '000000000000000000000000',
        msg_type: 'dm',
        sent_at: sentAt,
      })
    } catch (err) {
      console.error('[send]', err)
    } finally {
      setSending(false)
    }
  }

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? <span className="text-red-500">{bootstrapError}</span> : <span>Connecting…</span>}
      </div>
    )
  }

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Missing conversation id.
      </div>
    )
  }

  const displayName = friendName ?? (friendId ? friendId.slice(0, 8) + '…' : '…')

  return (
    <>
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{displayName}</span>
      </header>

      <main className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            content={m.content}
            sentAt={m.sentAt}
            isOwn={m.isOwn}
            status={m.status}
          />
        ))}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) }
          }}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-opacity disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          <Send size={16} />
        </button>
      </form>
    </>
  )
}
