'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Info, Send } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { getMessages, sendMessage, ackMessage } from '@/lib/relay'
import { encodePayload, decodePayload } from '@/lib/crypto'
import * as ws from '@/lib/ws'
import { db, type AnonThread, type StoredAnonMessage } from '@/lib/db'
import { MessageBubble } from '@/components/MessageBubble'
import type { ServerEnvelope } from '@/lib/types'

interface LocalMessage {
  id: string
  content: string
  sentAt: number
  // isOwn: initiator sent it (!from_author) OR author sent it (from_author)
  // i.e. isOwn = (isInitiator XOR from_author) with the spec's from_author semantics
  isOwn: boolean
}

function parseCompositeId(compositeId: string): { threadId: string; msgId: string } {
  const sep = compositeId.indexOf('|')
  return {
    threadId: compositeId.slice(0, sep),
    msgId: compositeId.slice(sep + 1),
  }
}

export default function AnonThreadPage() {
  const searchParams = useSearchParams()
  const threadId = searchParams.get('threadId')
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const token = useAppStore((s) => s.token)
  const router = useRouter()

  const [thread, setThread] = useState<AnonThread | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load thread metadata from Dexie.
  useEffect(() => {
    if (!threadId) return
    db.anonThreads.get(threadId).then((t) => {
      if (t) {
        setThread(t)
        setRevealed(t.status === 'revealed')
      }
    })
  }, [threadId])

  // Load persisted messages from Dexie on mount.
  useEffect(() => {
    if (!threadId) return
    db.anonMessages
      .where('threadId').equals(threadId)
      .sortBy('sentAt')
      .then((stored) => {
        setMessages(stored.map((m) => ({ id: m.id, content: m.content, sentAt: m.sentAt, isOwn: m.isOwn })))
      })
  }, [threadId])

  // Fetch pending anon messages for this thread, then ack them.
  useEffect(() => {
    if (!bootstrapped || !token || !userId || !thread || !threadId) return

    getMessages(token)
      .then(async ({ messages: envelopes }) => {
        const incoming: StoredAnonMessage[] = []
        for (const env of envelopes) {
          if (env.type !== 'message' || env.msg_type !== 'anon') continue
          const { threadId: envThread } = parseCompositeId(env.id)
          if (envThread !== threadId) continue

          const fromAuthor = env.sender_id !== userId && thread.isInitiator === 1
            ? true
            : env.sender_id === userId
          const isOwn = (thread.isInitiator === 1) !== fromAuthor

          incoming.push({
            id: env.id,
            threadId,
            content: decodePayload(env.payload_hex),
            sentAt: env.sent_at,
            isOwn,
          })
          await ackMessage(token, env.id).catch(() => {})
        }
        if (incoming.length > 0) {
          await db.anonMessages.bulkPut(incoming)
          const all = await db.anonMessages.where('threadId').equals(threadId).sortBy('sentAt')
          setMessages(all.map((m) => ({ id: m.id, content: m.content, sentAt: m.sentAt, isOwn: m.isOwn })))
        }
      })
      .catch(console.error)
  }, [bootstrapped, token, userId, thread, threadId])

  // Subscribe to WS for new anon messages on this thread.
  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'message' || env.msg_type !== 'anon') return
      if (!threadId) return
      const { threadId: envThread } = parseCompositeId(env.id)
      if (envThread !== threadId) return

      const myId = useAppStore.getState().userId
      const tok = useAppStore.getState().token
      if (!myId) return

      const isInitiator = thread?.isInitiator === 1
      const fromAuthor = isInitiator
        ? env.sender_id !== myId
        : env.sender_id === myId
      const isOwn = isInitiator !== fromAuthor

      const msg: StoredAnonMessage = {
        id: env.id,
        threadId,
        content: decodePayload(env.payload_hex),
        sentAt: env.sent_at,
        isOwn,
      }
      db.anonMessages.put(msg).catch(console.error)
      setMessages((prev) =>
        prev.some((m) => m.id === env.id)
          ? prev
          : [...prev, { id: msg.id, content: msg.content, sentAt: msg.sentAt, isOwn: msg.isOwn }],
      )
      if (tok) ackMessage(tok, env.id).catch(() => {})
    })
  }, [threadId, thread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !token || !thread || !threadId) return

    setSending(true)
    const msgId = crypto.randomUUID()
    const sentAt = Math.floor(Date.now() / 1000)
    const compositeId = `${threadId}|${msgId}`

    const newMsg: StoredAnonMessage = { id: compositeId, threadId, content: text, sentAt, isOwn: true }
    db.anonMessages.put(newMsg).catch(console.error)
    setMessages((prev) => [...prev, { id: compositeId, content: text, sentAt, isOwn: true }])
    setInput('')

    try {
      await sendMessage(token, {
        id: compositeId,
        recipient_id: thread.peerId,
        payload_hex: encodePayload(text),
        nonce_hex: '000000000000000000000000',
        msg_type: 'anon',
        sent_at: sentAt,
      })
    } catch (err) {
      console.error('[anon send]', err)
    } finally {
      setSending(false)
    }
  }

  async function handleReveal() {
    if (!threadId) return
    await db.anonThreads.update(threadId, { status: 'revealed' })
    setRevealed(true)
  }

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? <span className="text-red-500">{bootstrapError}</span> : <span>Connecting…</span>}
      </div>
    )
  }

  if (!threadId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Missing anonymous thread id.
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Anonymous thread</p>
          {thread?.postSnippet && (
            <p className="truncate text-xs text-zinc-400">re: &quot;{thread.postSnippet}&quot;</p>
          )}
        </div>
        <button className="text-zinc-400 hover:text-zinc-600">
          <Info size={18} />
        </button>
      </header>

      {/* Identity notice */}
      <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
        — both identities hidden —
      </div>

      {/* Messages */}
      <main className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            content={m.content}
            sentAt={m.sentAt}
            isOwn={m.isOwn}
          />
        ))}

        {/* Reveal prompt — shown once, soft UI convention only */}
        {!revealed && messages.length > 0 && (
          <div className="mx-auto mt-2">
            <button
              onClick={handleReveal}
              className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            >
              Reveal your name?
            </button>
          </div>
        )}
        {revealed && (
          <p className="mt-2 text-center text-xs text-zinc-400">Identity revealed (your choice)</p>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input */}
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
          className="flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          <Send size={16} />
        </button>
      </form>
    </>
  )
}
