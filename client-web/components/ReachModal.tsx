'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Send } from 'lucide-react'
import { generateEphemeralKeypair, computeThreadId, encodePayload } from '@/lib/crypto'
import { sendMessage } from '@/lib/relay'
import { db } from '@/lib/db'
import { useAppStore } from '@/lib/store'
import type { Post } from '@/lib/types'

interface Props {
  post: Post
  onClose: () => void
}

export function ReachModal({ post, onClose }: Props) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = message.trim()
    if (!text) return

    const token = useAppStore.getState().token
    if (!token) { setError('Not connected'); return }

    setSending(true)
    setError(null)

    try {
      const ephemeral = generateEphemeralKeypair()
      const threadId = computeThreadId(post.id, ephemeral.pubHex)
      const msgId = crypto.randomUUID()
      const sentAt = Math.floor(Date.now() / 1000)

      await db.anonThreads.add({
        id: threadId,
        postId: post.id,
        postSnippet: post.content.slice(0, 60),
        ephemeralPrivHex: ephemeral.privHex,
        ephemeralPubHex: ephemeral.pubHex,
        peerId: post.author_id,
        isInitiator: 1,
        status: 'open',
        createdAt: sentAt,
      })

      await sendMessage(token, {
        id: `${threadId}|${msgId}`,
        recipient_id: post.author_id,
        payload_hex: encodePayload(text),
        nonce_hex: '000000000000000000000000',
        msg_type: 'anon',
        sent_at: sentAt,
      })

      onClose()
      router.push(`/anon?threadId=${encodeURIComponent(threadId)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Reach anonymously?
          </h2>
          <button onClick={onClose} className="mt-0.5 text-zinc-400 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>

        {/* Post snippet */}
        <div className="mb-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-[11px] font-medium text-zinc-400"># anon</p>
          <p className="mt-1 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-200">
            {post.content}
          </p>
        </div>

        <p className="mb-4 text-xs text-zinc-400">
          They won&apos;t know it&apos;s you. A thread opens only if they reply.
        </p>

        <form onSubmit={handleSend} className="flex flex-col gap-3">
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Say something…"
            rows={3}
            maxLength={500}
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border border-zinc-200 py-2 text-sm text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || !message.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
            >
              <Send size={13} />
              {sending ? 'Sending…' : 'Send →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
